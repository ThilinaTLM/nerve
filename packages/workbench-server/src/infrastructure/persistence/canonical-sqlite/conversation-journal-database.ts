import type { DatabaseSync } from "node:sqlite";
import type { ConversationRecord } from "@nervekit/contracts/conversations";
import type {
  ConversationPersistenceDelta,
  MaterializedConversationRecord,
  SerializedConversationState,
} from "../../../domains/conversations/conversation-state-materializer.js";
import {
  upsertConversationRecordProjection,
  upsertToolCallProjection,
} from "../../../domains/conversations/conversation-state-materializer.js";
import { decode, encode } from "./payload-codecs.js";

export interface JournalHead {
  revision: number;
  checksum?: string;
}

interface DurableEventInput {
  stream: string;
  intentId: string;
  eventType: string;
  data: unknown;
  occurredAt: string;
  conversationId?: string;
}

export function journalRevisionDocumentId(revision: number): string {
  return String(revision).padStart(20, "0");
}

export function listConversationJournalIds(database: DatabaseSync): string[] {
  const rows = database
    .prepare(
      `SELECT DISTINCT scope_id FROM domain_documents
       WHERE namespace IN (
         'conversation_state',
         'conversation_journal_head',
         'conversation_journal_commit'
       ) ORDER BY scope_id`,
    )
    .all() as Array<{ scope_id: string }>;
  return rows.map((row) => row.scope_id);
}

export function readConversationCommits(
  database: DatabaseSync,
  conversationId: string,
  afterRevision: number,
): unknown[] {
  const rows = database
    .prepare(
      `SELECT data FROM domain_documents
       WHERE namespace = 'conversation_journal_commit'
         AND scope_id = ? AND document_id > ?
       ORDER BY document_id`,
    )
    .all(conversationId, journalRevisionDocumentId(afterRevision)) as Array<{
    data: Uint8Array | string;
  }>;
  return rows.map((row) => decode(row.data));
}

export function readConversationJournalHead(
  database: DatabaseSync,
  conversationId: string,
): JournalHead | undefined {
  const row = database
    .prepare(
      `SELECT data FROM domain_documents
       WHERE namespace = 'conversation_journal_head'
         AND scope_id = ? AND document_id = 'head'`,
    )
    .get(conversationId) as { data: Uint8Array | string } | undefined;
  return row ? (decode(row.data) as JournalHead) : undefined;
}

export function persistConversationCommitInTransaction(
  database: DatabaseSync,
  delta: ConversationPersistenceDelta,
  appendDurableEvent: (input: DurableEventInput) => void,
): void {
  const existingCommit = database
    .prepare(
      `SELECT data FROM domain_documents
       WHERE namespace = 'conversation_journal_commit'
         AND scope_id = ? AND document_id = ?`,
    )
    .get(
      delta.conversationId,
      journalRevisionDocumentId(delta.commit.revision),
    ) as { data: Uint8Array | string } | undefined;
  if (existingCommit) {
    if (
      JSON.stringify(decode(existingCommit.data)) !==
      JSON.stringify(delta.commit)
    ) {
      throw new Error("Conflicting conversation journal revision.");
    }
    return;
  }

  const currentHead = readConversationJournalHead(
    database,
    delta.conversationId,
  );
  const baseHead =
    currentHead ?? readSnapshotHead(database, delta.conversationId);
  const actualRevision = baseHead?.revision ?? 0;
  if (
    actualRevision !== delta.previousRevision ||
    baseHead?.checksum !== delta.previousChecksum
  ) {
    throw new Error(
      `Conversation journal '${delta.conversationId}' revision conflict: expected ${delta.previousRevision}, current ${actualRevision}.`,
    );
  }

  const timestamp = Date.parse(delta.commit.committedAt);
  database
    .prepare(
      `INSERT INTO domain_documents (
         namespace, scope_id, document_id, revision, payload_version, data,
         created_at_ms, updated_at_ms
       ) VALUES ('conversation_journal_commit', ?, ?, ?, 1, ?, ?, ?)`,
    )
    .run(
      delta.conversationId,
      journalRevisionDocumentId(delta.commit.revision),
      delta.commit.revision,
      encode(delta.commit),
      timestamp,
      timestamp,
    );
  upsertJournalHead(database, {
    conversationId: delta.conversationId,
    revision: delta.commit.revision,
    checksum: delta.commit.checksum,
    timestamp,
  });
  if (delta.conversation) {
    upsertConversationDocument(database, delta.conversation);
  }
  materializeConversationDelta(database, delta);
  appendDurableEvent({
    stream: `internal/conv/${delta.conversationId}`,
    conversationId: delta.conversationId,
    intentId: delta.commit.commitId,
    eventType: delta.commit.kind,
    data: { version: 1, events: delta.commit.events },
    occurredAt: delta.commit.committedAt,
  });
}

export function checkpointConversationStateInTransaction(
  database: DatabaseSync,
  serialized: SerializedConversationState,
): void {
  checkpointEncodedConversationStateInTransaction(database, {
    conversationId: serialized.conversationId,
    revision: serialized.revision,
    checksum: serialized.checksum,
    data: encode(serialized),
  });
}

export function checkpointEncodedConversationStateInTransaction(
  database: DatabaseSync,
  input: {
    conversationId: string;
    revision: number;
    checksum?: string;
    data: Uint8Array;
  },
): void {
  const head = readConversationJournalHead(database, input.conversationId);
  if (
    head &&
    (head.revision !== input.revision || head.checksum !== input.checksum)
  ) {
    throw new Error(
      `Conversation checkpoint '${input.conversationId}' revision conflict: expected ${input.revision}, current ${head.revision}.`,
    );
  }
  const timestamp = Date.now();
  database
    .prepare(
      `INSERT INTO domain_documents (
         namespace, scope_id, document_id, revision, payload_version, data,
         created_at_ms, updated_at_ms
       ) VALUES ('conversation_state', ?, 'state', ?, 1, ?, ?, ?)
       ON CONFLICT(namespace, scope_id, document_id) DO UPDATE SET
         revision = excluded.revision, data = excluded.data,
         updated_at_ms = excluded.updated_at_ms`,
    )
    .run(
      input.conversationId,
      Math.max(1, input.revision),
      input.data,
      timestamp,
      timestamp,
    );
  database
    .prepare(
      `DELETE FROM domain_documents
       WHERE namespace = 'conversation_journal_commit'
         AND scope_id = ? AND CAST(document_id AS INTEGER) <= ?`,
    )
    .run(input.conversationId, input.revision);
}

function readSnapshotHead(
  database: DatabaseSync,
  conversationId: string,
): JournalHead | undefined {
  const row = database
    .prepare(
      `SELECT data FROM domain_documents
       WHERE namespace = 'conversation_state'
         AND scope_id = ? AND document_id = 'state'`,
    )
    .get(conversationId) as { data: Uint8Array | string } | undefined;
  if (!row) return undefined;
  const state = decode(row.data) as SerializedConversationState;
  return { revision: state.revision, checksum: state.checksum };
}

function upsertJournalHead(
  database: DatabaseSync,
  input: {
    conversationId: string;
    revision: number;
    checksum: string;
    timestamp: number;
  },
): void {
  database
    .prepare(
      `INSERT INTO domain_documents (
         namespace, scope_id, document_id, revision, payload_version, data,
         created_at_ms, updated_at_ms
       ) VALUES ('conversation_journal_head', ?, 'head', ?, 1, ?, ?, ?)
       ON CONFLICT(namespace, scope_id, document_id) DO UPDATE SET
         revision = excluded.revision, data = excluded.data,
         updated_at_ms = excluded.updated_at_ms`,
    )
    .run(
      input.conversationId,
      input.revision,
      encode({ revision: input.revision, checksum: input.checksum }),
      input.timestamp,
      input.timestamp,
    );
}

function upsertConversationDocument(
  database: DatabaseSync,
  conversation: ConversationRecord,
): void {
  database
    .prepare(
      `INSERT INTO domain_documents (
         namespace, scope_id, document_id, revision, payload_version,
         data, created_at_ms, updated_at_ms
       ) VALUES ('conversation', 'global', ?, 1, 1, ?, ?, ?)
       ON CONFLICT(namespace, scope_id, document_id) DO UPDATE SET
         revision = domain_documents.revision + 1,
         data = excluded.data, updated_at_ms = excluded.updated_at_ms`,
    )
    .run(
      conversation.id,
      encode(conversation),
      Date.parse(conversation.createdAt),
      Date.parse(conversation.updatedAt),
    );
}

function materializeConversationDelta(
  database: DatabaseSync,
  delta: ConversationPersistenceDelta,
): void {
  const ordered = orderAffectedRecords(delta.records);
  const existingSequence = database.prepare(
    `SELECT sequence FROM conversation_records
     WHERE conversation_id = ? AND id = ?`,
  );
  let nextSequence = (
    database
      .prepare(
        `SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
         FROM conversation_records WHERE conversation_id = ?`,
      )
      .get(delta.conversationId) as { sequence: number }
  ).sequence;
  const recordExists = database.prepare(
    `SELECT 1 AS present FROM conversation_records WHERE id = ?`,
  );
  const insert = database.prepare(
    `INSERT INTO conversation_records (
       id, conversation_id, agent_id, parent_id, run_id, group_id, sequence,
       revision, kind, status, payload_version, data, created_at_ms, updated_at_ms,
       run_delivery_settled_revision
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       conversation_id = excluded.conversation_id,
       agent_id = excluded.agent_id,
       parent_id = excluded.parent_id,
       run_id = excluded.run_id,
       group_id = excluded.group_id,
       sequence = excluded.sequence,
       revision = excluded.revision,
       kind = excluded.kind,
       status = excluded.status,
       payload_version = excluded.payload_version,
       data = excluded.data,
       created_at_ms = excluded.created_at_ms,
       updated_at_ms = excluded.updated_at_ms,
       run_delivery_settled_revision = excluded.run_delivery_settled_revision`,
  );
  for (const record of ordered) {
    const stored = existingSequence.get(delta.conversationId, record.id) as
      | { sequence: number }
      | undefined;
    const sequence = stored?.sequence ?? nextSequence++;
    const parentId =
      record.parentId && recordExists.get(record.parentId)
        ? record.parentId
        : null;
    insert.run(
      record.id,
      delta.conversationId,
      record.agentId ?? null,
      parentId,
      record.runId ?? null,
      record.groupId ?? null,
      sequence,
      record.revision,
      record.kind,
      record.status,
      record.payloadVersion ?? 1,
      encode(record.data),
      Date.parse(record.createdAt),
      Date.parse(record.updatedAt),
      record.runDeliverySettledRevision ?? null,
    );
    upsertConversationRecordProjection(
      database,
      delta.conversationId,
      sequence,
      record,
    );
    upsertToolCallProjection(database, delta.conversationId, record);
  }

  const insertLeaf = database.prepare(
    `INSERT INTO agent_context_leaves (
       conversation_id, agent_id, active_record_id, revision
     ) VALUES (?, ?, ?, ?)
     ON CONFLICT(conversation_id, agent_id) DO UPDATE SET
       active_record_id = excluded.active_record_id,
       revision = excluded.revision`,
  );
  for (const leaf of delta.leaves) {
    const activeRecordId =
      leaf.activeRecordId && recordExists.get(leaf.activeRecordId)
        ? leaf.activeRecordId
        : null;
    insertLeaf.run(
      delta.conversationId,
      leaf.agentId,
      activeRecordId,
      Math.max(1, leaf.revision),
    );
  }
}

function orderAffectedRecords(
  records: readonly MaterializedConversationRecord[],
): MaterializedConversationRecord[] {
  const remaining = new Map(records.map((record) => [record.id, record]));
  const ordered: MaterializedConversationRecord[] = [];
  while (remaining.size > 0) {
    let advanced = false;
    for (const [id, record] of remaining) {
      if (record.parentId && remaining.has(record.parentId)) continue;
      ordered.push(record);
      remaining.delete(id);
      advanced = true;
    }
    if (!advanced) {
      ordered.push(...remaining.values());
      break;
    }
  }
  return ordered;
}
