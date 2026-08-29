import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ConversationJournalCommit } from "@nervekit/contracts";
import {
  deserializeState,
  materializeConversationRecords,
  type ConversationPersistenceDelta,
  type SerializedConversationState,
} from "../../../domains/conversations/conversation-state-materializer.js";
import {
  checkpointConversationStateInTransaction,
  listConversationJournalIds,
  persistConversationCommitInTransaction,
  readConversationCommits,
  readConversationJournalHead,
} from "./conversation-journal-database.js";
import { decode, encode } from "./payload-codecs.js";
import {
  CANONICAL_BASELINE_NAME,
  CANONICAL_SCHEMA_CHECKSUM,
  CANONICAL_SCHEMA_SQL,
  CANONICAL_SCHEMA_V1_CHECKSUM,
  CANONICAL_SCHEMA_VERSION,
  CANONICAL_V1_TO_V2_MIGRATION_NAME,
  CANONICAL_V1_TO_V2_MIGRATION_SQL,
} from "./schema.js";

export interface CanonicalDocument<T = unknown> {
  namespace: string;
  scopeId: string;
  documentId: string;
  revision: number;
  payloadVersion: number;
  data: T;
  createdAt: string;
  updatedAt: string;
}

/**
 * Canonical SQLite owner. All mutation helpers serialize through SQLite
 * `BEGIN IMMEDIATE`; callers receive compare-and-swap failures rather than
 * silently overwriting a newer revision.
 */
export class CanonicalDatabase {
  private readonly database: DatabaseSync;

  constructor(
    readonly path: string,
    options: { queryOnly?: boolean } = {},
  ) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA busy_timeout = 5000");
    if (options.queryOnly) {
      this.database.exec("PRAGMA query_only = ON");
    } else {
      this.database.exec("PRAGMA journal_mode = WAL");
      this.database.exec("PRAGMA synchronous = FULL");
    }
  }

  initialize(): void {
    const hasLedger = this.database
      .prepare(
        `SELECT 1 AS present FROM sqlite_master
         WHERE type = 'table' AND name = 'schema_migrations'`,
      )
      .get() as { present?: number } | undefined;
    if (hasLedger?.present !== 1) {
      this.database.exec(CANONICAL_SCHEMA_SQL);
      this.database
        .prepare(
          `INSERT INTO schema_migrations (
             version, name, checksum, applied_at_ms, duration_ms
           ) VALUES (?, ?, ?, ?, 0)`,
        )
        .run(
          CANONICAL_SCHEMA_VERSION,
          CANONICAL_BASELINE_NAME,
          CANONICAL_SCHEMA_CHECKSUM,
          Date.now(),
        );
      return;
    }

    const rows = this.schemaMigrationRows();
    this.assertSchemaCompatible(rows);
    if (rows.at(-1)?.version === 1) this.migrateV1ToV2();
  }

  assertSchemaCompatible(
    rows: Array<{
      version: number;
      checksum: string;
    }> = this.schemaMigrationRows(),
  ): void {
    const newest = rows.at(-1);
    if (!newest) throw new Error("Storage schema migration ledger is empty.");
    if (newest.version > CANONICAL_SCHEMA_VERSION) {
      throw new Error(
        `Storage schema ${newest.version} is newer than supported schema ${CANONICAL_SCHEMA_VERSION}.`,
      );
    }
    const checksums = new Map([
      [1, CANONICAL_SCHEMA_V1_CHECKSUM],
      [CANONICAL_SCHEMA_VERSION, CANONICAL_SCHEMA_CHECKSUM],
    ]);
    for (const row of rows) {
      const expected = checksums.get(row.version);
      if (!expected) {
        throw new Error(
          `Storage schema version ${row.version} is unsupported.`,
        );
      }
      if (row.checksum !== expected) {
        throw new Error(
          `Storage schema checksum drift at version ${row.version}.`,
        );
      }
    }
  }

  private schemaMigrationRows(): Array<{
    version: number;
    checksum: string;
  }> {
    return this.database
      .prepare(
        `SELECT version, checksum FROM schema_migrations ORDER BY version`,
      )
      .all() as unknown as Array<{ version: number; checksum: string }>;
  }

  private migrateV1ToV2(): void {
    const startedAt = Date.now();
    this.transaction((database) => {
      database.exec(CANONICAL_V1_TO_V2_MIGRATION_SQL);
      database
        .prepare(
          `INSERT INTO schema_migrations (
             version, name, checksum, applied_at_ms, duration_ms
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          CANONICAL_SCHEMA_VERSION,
          CANONICAL_V1_TO_V2_MIGRATION_NAME,
          CANONICAL_SCHEMA_CHECKSUM,
          Date.now(),
          Date.now() - startedAt,
        );
    });
  }

  close(checkpoint = true): void {
    if (checkpoint) this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.database.close();
  }

  transaction<T>(operation: (database: DatabaseSync) => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation(this.database);
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // Preserve the original transaction error.
      }
      throw error;
    }
  }

  readDocument<T>(
    namespace: string,
    scopeId: string,
    documentId: string,
  ): CanonicalDocument<T> | undefined {
    const row = this.database
      .prepare(
        `SELECT revision, payload_version, data, created_at_ms, updated_at_ms
         FROM domain_documents
         WHERE namespace = ? AND scope_id = ? AND document_id = ?`,
      )
      .get(namespace, scopeId, documentId) as DocumentRow | undefined;
    return row
      ? decodeDocument(namespace, scopeId, documentId, row)
      : undefined;
  }

  listDocuments<T>(
    namespace: string,
    scopeId?: string,
  ): CanonicalDocument<T>[] {
    const rows = (scopeId === undefined
      ? this.database
          .prepare(
            `SELECT scope_id, document_id, revision, payload_version, data,
                    created_at_ms, updated_at_ms
             FROM domain_documents WHERE namespace = ?
             ORDER BY updated_at_ms, document_id`,
          )
          .all(namespace)
      : this.database
          .prepare(
            `SELECT scope_id, document_id, revision, payload_version, data,
                    created_at_ms, updated_at_ms
             FROM domain_documents WHERE namespace = ? AND scope_id = ?
             ORDER BY updated_at_ms, document_id`,
          )
          .all(namespace, scopeId)) as unknown as Array<
      DocumentRow & { scope_id: string; document_id: string }
    >;
    return rows.map((row) =>
      decodeDocument(namespace, row.scope_id, row.document_id, row),
    );
  }
  listDocumentKeys(
    namespace: string,
    scopeId?: string,
  ): Array<{ scopeId: string; documentId: string }> {
    const rows = (scopeId === undefined
      ? this.database
          .prepare(
            `SELECT scope_id, document_id FROM domain_documents
             WHERE namespace = ? ORDER BY scope_id, document_id`,
          )
          .all(namespace)
      : this.database
          .prepare(
            `SELECT scope_id, document_id FROM domain_documents
             WHERE namespace = ? AND scope_id = ?
             ORDER BY scope_id, document_id`,
          )
          .all(namespace, scopeId)) as unknown as Array<{
      scope_id: string;
      document_id: string;
    }>;
    return rows.map((row) => ({
      scopeId: row.scope_id,
      documentId: row.document_id,
    }));
  }

  writeDocument<T>(input: {
    namespace: string;
    scopeId: string;
    documentId: string;
    data: T;
    payloadVersion?: number;
    expectedRevision?: number;
    now?: string;
  }): CanonicalDocument<T> {
    return this.transaction((database) => {
      const existing = database
        .prepare(
          `SELECT revision, created_at_ms FROM domain_documents
           WHERE namespace = ? AND scope_id = ? AND document_id = ?`,
        )
        .get(input.namespace, input.scopeId, input.documentId) as
        | { revision: number; created_at_ms: number }
        | undefined;
      const actual = existing?.revision ?? 0;
      if (
        input.expectedRevision !== undefined &&
        input.expectedRevision !== actual
      ) {
        throw new CanonicalRevisionConflictError(
          `${input.namespace}/${input.scopeId}/${input.documentId}`,
          input.expectedRevision,
          actual,
        );
      }
      const now = input.now ?? new Date().toISOString();
      const timestamp = Date.parse(now);
      const revision = actual + 1;
      database
        .prepare(
          `INSERT INTO domain_documents (
             namespace, scope_id, document_id, revision, payload_version, data,
             created_at_ms, updated_at_ms
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(namespace, scope_id, document_id) DO UPDATE SET
             revision = excluded.revision,
             payload_version = excluded.payload_version,
             data = excluded.data,
             updated_at_ms = excluded.updated_at_ms`,
        )
        .run(
          input.namespace,
          input.scopeId,
          input.documentId,
          revision,
          input.payloadVersion ?? 1,
          encode(input.data),
          existing?.created_at_ms ?? timestamp,
          timestamp,
        );
      return {
        namespace: input.namespace,
        scopeId: input.scopeId,
        documentId: input.documentId,
        revision,
        payloadVersion: input.payloadVersion ?? 1,
        data: input.data,
        createdAt: new Date(existing?.created_at_ms ?? timestamp).toISOString(),
        updatedAt: now,
      };
    });
  }

  deleteDocument(
    namespace: string,
    scopeId: string,
    documentId?: string,
  ): void {
    if (documentId === undefined) {
      this.database
        .prepare(
          `DELETE FROM domain_documents WHERE namespace = ? AND scope_id = ?`,
        )
        .run(namespace, scopeId);
      return;
    }
    this.database
      .prepare(
        `DELETE FROM domain_documents
         WHERE namespace = ? AND scope_id = ? AND document_id = ?`,
      )
      .run(namespace, scopeId, documentId);
  }

  appendDurableEvent(input: {
    stream: string;
    intentId: string;
    eventType: string;
    data: unknown;
    occurredAt: string;
    conversationId?: string;
  }): { sequence: number; intentId: string } {
    return this.transaction((database) => {
      return appendDurableEventInTransaction(database, input);
    });
  }

  durableEventForIntent(intentId: string):
    | {
        sequence: number;
        stream: string;
        intentId: string;
        eventType: string;
        data: unknown;
        occurredAt: string;
      }
    | undefined {
    const row = this.database
      .prepare(
        `SELECT stream_sequence, stream, intent_id, event_type, data, occurred_at_ms
         FROM durable_events WHERE intent_id = ?`,
      )
      .get(intentId) as DurableEventRow | undefined;
    return row ? decodeDurableEvent(row) : undefined;
  }

  readDurableEvents(stream: string, fromSequence: number, limit: number) {
    const rows = this.database
      .prepare(
        `SELECT stream_sequence, stream, intent_id, event_type, data, occurred_at_ms
         FROM durable_events
         WHERE stream = ? AND stream_sequence >= ?
         ORDER BY stream_sequence LIMIT ?`,
      )
      .all(stream, fromSequence, limit) as unknown as DurableEventRow[];
    return rows.map(decodeDurableEvent);
  }

  durableEventBounds(stream: string): {
    stream: string;
    earliestAvailableSeq: number;
    latestSeq: number;
  } {
    const row = this.database
      .prepare(
        `SELECT MIN(stream_sequence) AS earliest, MAX(stream_sequence) AS latest
         FROM durable_events WHERE stream = ?`,
      )
      .get(stream) as { earliest: number | null; latest: number | null };
    const latestSeq = row.latest ?? 0;
    return {
      stream,
      earliestAvailableSeq:
        row.earliest ?? (latestSeq === 0 ? 1 : latestSeq + 1),
      latestSeq,
    };
  }

  removeDurableEventStream(stream: string): void {
    this.database
      .prepare(`DELETE FROM durable_events WHERE stream = ?`)
      .run(stream);
  }

  listConversationJournalIds(): string[] {
    return listConversationJournalIds(this.database);
  }

  readConversationJournal(conversationId: string): {
    snapshot?: SerializedConversationState;
    commits: unknown[];
    head?: { revision: number; checksum?: string };
  } {
    this.database.exec("BEGIN");
    try {
      const snapshot = this.readDocument<SerializedConversationState>(
        "conversation_state",
        conversationId,
        "state",
      )?.data;
      const commits = readConversationCommits(
        this.database,
        conversationId,
        snapshot?.revision ?? 0,
      );
      const head = readConversationJournalHead(this.database, conversationId);
      this.database.exec("COMMIT");
      return {
        ...(snapshot ? { snapshot } : {}),
        commits,
        ...(head ? { head } : {}),
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  persistConversationCommit(delta: ConversationPersistenceDelta): void {
    this.transaction((database) =>
      persistConversationCommitInTransaction(database, delta, (input) => {
        appendDurableEventInTransaction(database, input);
      }),
    );
  }

  checkpointConversationState(serialized: SerializedConversationState): void {
    this.transaction((database) =>
      checkpointConversationStateInTransaction(database, serialized),
    );
  }
  persistConversationState(
    serialized: SerializedConversationState,
    commit?: ConversationJournalCommit,
  ): void {
    const state = deserializeState(serialized);
    this.transaction((database) => {
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
          state.conversationId,
          Math.max(1, state.revision),
          encode(serialized),
          timestamp,
          timestamp,
        );
      if (state.conversation) {
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
            state.conversation.id,
            encode(state.conversation),
            Date.parse(state.conversation.createdAt),
            Date.parse(state.conversation.updatedAt),
          );
      }
      materializeConversationRecords(database, state, commit);
      if (commit) {
        appendDurableEventInTransaction(database, {
          stream: `internal/conv/${state.conversationId}`,
          conversationId: state.conversationId,
          intentId: commit.commitId,
          eventType: commit.kind,
          data: { version: 1, events: commit.events },
          occurredAt: commit.committedAt,
        });
      }
    });
  }

  deleteConversationState(conversationId: string): void {
    this.transaction((database) => {
      database
        .prepare(`DELETE FROM durable_events WHERE conversation_id = ?`)
        .run(conversationId);
      database
        .prepare(`DELETE FROM agent_context_leaves WHERE conversation_id = ?`)
        .run(conversationId);
      database
        .prepare(
          `UPDATE conversation_records SET parent_id = NULL WHERE conversation_id = ?`,
        )
        .run(conversationId);
      database
        .prepare(`DELETE FROM conversation_records WHERE conversation_id = ?`)
        .run(conversationId);
      database
        .prepare(
          `DELETE FROM domain_documents
           WHERE (namespace IN (
                    'conversation_state',
                    'conversation_journal_head',
                    'conversation_journal_commit'
                  ) AND scope_id = ?)
              OR (namespace = 'conversation' AND document_id = ?)`,
        )
        .run(conversationId, conversationId);
    });
  }

  integrityCheck(): void {
    const foreignKeys = this.database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeys.length > 0)
      throw new Error("SQLite foreign key check failed.");
    const result = this.database.prepare("PRAGMA quick_check").get() as
      | { quick_check?: string }
      | undefined;
    if (result?.quick_check !== "ok")
      throw new Error("SQLite quick check failed.");
  }
}

function appendDurableEventInTransaction(
  database: DatabaseSync,
  input: {
    stream: string;
    intentId: string;
    eventType: string;
    data: unknown;
    occurredAt: string;
    conversationId?: string;
  },
): { sequence: number; intentId: string } {
  const existing = database
    .prepare(
      `SELECT stream_sequence, stream, event_type, data
       FROM durable_events WHERE intent_id = ?`,
    )
    .get(input.intentId) as
    | {
        stream_sequence: number;
        stream: string;
        event_type: string;
        data: Uint8Array | string;
      }
    | undefined;
  if (existing) {
    if (
      existing.stream !== input.stream ||
      existing.event_type !== input.eventType ||
      JSON.stringify(decode(existing.data)) !== JSON.stringify(input.data)
    ) {
      throw new Error(`Conflicting event intent id: ${input.intentId}`);
    }
    return { sequence: existing.stream_sequence, intentId: input.intentId };
  }

  database
    .prepare(
      `INSERT INTO durable_event_stream_counters (stream, next_sequence)
       VALUES (?, 1) ON CONFLICT(stream) DO NOTHING`,
    )
    .run(input.stream);
  const counter = database
    .prepare(
      `SELECT next_sequence FROM durable_event_stream_counters WHERE stream = ?`,
    )
    .get(input.stream) as { next_sequence: number };
  const sequence = counter.next_sequence;
  database
    .prepare(
      `INSERT INTO durable_events (
         stream, stream_sequence, conversation_id, record_id, record_revision,
         intent_id, event_type, payload_version, data, occurred_at_ms
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, 1, ?, ?)`,
    )
    .run(
      input.stream,
      sequence,
      input.conversationId ?? null,
      input.intentId,
      input.eventType,
      encode(input.data),
      Date.parse(input.occurredAt),
    );
  database
    .prepare(
      `UPDATE durable_event_stream_counters SET next_sequence = ? WHERE stream = ?`,
    )
    .run(sequence + 1, input.stream);
  return { sequence, intentId: input.intentId };
}

export class CanonicalRevisionConflictError extends Error {
  constructor(
    readonly identity: string,
    readonly expected: number,
    readonly actual: number,
  ) {
    super(
      `${identity} revision conflict: expected ${expected}, current ${actual}.`,
    );
    this.name = "CanonicalRevisionConflictError";
  }
}

interface DocumentRow {
  revision: number;
  payload_version: number;
  data: Uint8Array | string;
  created_at_ms: number;
  updated_at_ms: number;
}

interface DurableEventRow {
  stream_sequence: number;
  stream: string;
  intent_id: string;
  event_type: string;
  data: Uint8Array | string;
  occurred_at_ms: number;
}

function decodeDocument<T>(
  namespace: string,
  scopeId: string,
  documentId: string,
  row: DocumentRow,
): CanonicalDocument<T> {
  return {
    namespace,
    scopeId,
    documentId,
    revision: row.revision,
    payloadVersion: row.payload_version,
    data: decode(row.data) as T,
    createdAt: new Date(row.created_at_ms).toISOString(),
    updatedAt: new Date(row.updated_at_ms).toISOString(),
  };
}

function decodeDurableEvent(row: DurableEventRow) {
  return {
    sequence: row.stream_sequence,
    stream: row.stream,
    intentId: row.intent_id,
    eventType: row.event_type,
    data: decode(row.data),
    occurredAt: new Date(row.occurred_at_ms).toISOString(),
  };
}

export { decode, encode } from "./payload-codecs.js";
