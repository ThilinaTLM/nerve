import type { DatabaseSync } from "node:sqlite";
import type {
  ConversationEntry,
  ConversationInteractionRecord,
  ConversationJournalCommit,
  ConversationRecord,
  ConversationSuspensionRecord,
  ToolCallRecord,
} from "@nervekit/contracts";
import type { ConversationTreeEntry } from "@nervekit/harness";
import { encode } from "../../infrastructure/canonical-store/payload-codecs.js";
import type {
  ConversationJournalState,
  ConversationRunProjection,
} from "./conversation-journal.repository.js";

export interface SerializedConversationState {
  conversationId: string;
  revision: number;
  checksum?: string;
  conversation?: ConversationRecord;
  entries: ConversationEntry[];
  modelEntries: ConversationTreeEntry[];
  modelLeafId: string | null;
  agentModelEntries: Array<[string, ConversationTreeEntry[]]>;
  agentModelLeafIds: Array<[string, string | null]>;
  toolCalls: Array<[string, ToolCallRecord]>;
  runProjections: Array<[string, ConversationRunProjection]>;
  interactions: Array<[string, ConversationInteractionRecord]>;
  suspensions: Array<[string, ConversationSuspensionRecord]>;
  idempotencyKeys: Array<[string, ConversationJournalCommit]>;
  intentConversationRevisions: Array<[string, number]>;
}

export function serializeState(
  state: ConversationJournalState,
): SerializedConversationState {
  return {
    conversationId: state.conversationId,
    revision: state.revision,
    checksum: state.checksum,
    conversation: state.conversation,
    entries: state.entries,
    modelEntries: state.modelEntries,
    modelLeafId: state.modelLeafId,
    agentModelEntries: [...state.agentModelEntries],
    agentModelLeafIds: [...state.agentModelLeafIds],
    toolCalls: [...state.toolCalls],
    runProjections: [...state.runProjections],
    interactions: [...state.interactions],
    suspensions: [...state.suspensions],
    idempotencyKeys: [...state.idempotencyKeys],
    intentConversationRevisions: [...state.intentConversationRevisions],
  };
}

export function deserializeState(
  state: SerializedConversationState,
): ConversationJournalState {
  return {
    conversationId: state.conversationId,
    revision: state.revision,
    checksum: state.checksum,
    conversation: state.conversation,
    entries: state.entries,
    modelEntries: state.modelEntries,
    modelLeafId: state.modelLeafId,
    agentModelEntries: new Map(state.agentModelEntries),
    agentModelLeafIds: new Map(state.agentModelLeafIds),
    toolCalls: new Map(state.toolCalls),
    runProjections: new Map(state.runProjections),
    interactions: new Map(state.interactions),
    suspensions: new Map(state.suspensions),
    idempotencyKeys: new Map(state.idempotencyKeys),
    intentConversationRevisions: new Map(state.intentConversationRevisions),
  };
}

interface MaterializedRecord {
  id: string;
  agentId?: string;
  parentId?: string;
  runId?: string;
  groupId?: string;
  kind: "message" | "summary" | "run" | "tool_call" | "tool_batch";
  status: string;
  revision: number;
  data: unknown;
  createdAt: string;
  updatedAt: string;
}

export function materializeConversationRecords(
  database: DatabaseSync,
  state: ConversationJournalState,
  commit?: ConversationJournalCommit,
): void {
  // Cold imports rebuild the complete projection. Hot journal commits only
  // upsert records named by the commit; deleting and re-encoding the entire
  // conversation here made every tool lifecycle write O(history size).
  if (!commit) {
    database
      .prepare(
        `UPDATE conversation_records SET parent_id = NULL WHERE conversation_id = ?`,
      )
      .run(state.conversationId);
    database
      .prepare(`DELETE FROM conversation_records WHERE conversation_id = ?`)
      .run(state.conversationId);
  }
  database
    .prepare(`DELETE FROM agent_context_leaves WHERE conversation_id = ?`)
    .run(state.conversationId);

  const records = new Map<string, MaterializedRecord>();
  for (const entry of state.entries) {
    const summary =
      entry.kind === "compaction" || entry.kind === "branch_summary";
    records.set(entry.id, {
      id: entry.id,
      agentId: entry.agentId,
      parentId: entry.parentEntryId,
      runId: entry.runId,
      kind: summary ? "summary" : "message",
      status: "completed",
      revision: 1,
      data: summary
        ? {
            version: 1,
            entry,
            firstRetainedRecordId: entry.firstKeptEntryId,
            tokensBefore: entry.tokensBefore,
          }
        : { version: 1, entry },
      createdAt: entry.createdAt,
      updatedAt: entry.createdAt,
    });
  }
  const modelEntries: Array<
    readonly [string | undefined, ConversationTreeEntry]
  > = [
    ...state.modelEntries.map((entry) => [undefined, entry] as const),
    ...[...state.agentModelEntries].flatMap(([agentId, entries]) =>
      entries.map((entry) => [agentId, entry] as const),
    ),
  ];
  for (const [agentId, entry] of modelEntries) {
    const existing = records.get(entry.id);
    const summary =
      entry.type === "compaction" || entry.type === "branch_summary";
    records.set(entry.id, {
      id: entry.id,
      agentId: agentId ?? existing?.agentId,
      parentId: entry.parentId ?? existing?.parentId,
      runId: existing?.runId,
      kind: existing?.kind ?? (summary ? "summary" : "message"),
      status: "completed",
      revision: existing?.revision ?? 1,
      data: {
        ...(existing?.data &&
        typeof existing.data === "object" &&
        !Array.isArray(existing.data)
          ? existing.data
          : { version: 1 }),
        modelContext: {
          visibility: existing ? "model_and_history" : "model_only",
          entry,
        },
      },
      createdAt: existing?.createdAt ?? entry.timestamp,
      updatedAt: entry.timestamp,
    });
  }
  for (const toolCall of state.toolCalls.values()) {
    records.set(toolCall.id, {
      id: toolCall.id,
      agentId: toolCall.agentId,
      runId: toolCall.runId,
      groupId: toolCall.groupId,
      kind: "tool_call",
      status: toolCall.phase ?? toolCall.status,
      revision: toolCall.revision,
      data: { version: 1, toolCall },
      createdAt: toolCall.createdAt,
      updatedAt: toolCall.updatedAt,
    });
  }
  for (const projection of state.runProjections.values()) {
    records.set(projection.run.runId, {
      id: projection.run.runId,
      agentId: projection.run.agentId,
      runId: projection.run.runId,
      kind: "run",
      status: projection.run.status,
      revision: projection.run.revision,
      data: { version: 1, run: projection.run, state: projection },
      createdAt: projection.run.createdAt,
      updatedAt: projection.run.updatedAt,
    });
  }

  const known = new Set(records.keys());
  const pending = [...records.values()];
  const ordered: MaterializedRecord[] = [];
  const inserted = new Set<string>();
  while (pending.length > 0) {
    const index = pending.findIndex(
      (record) =>
        !record.parentId ||
        !known.has(record.parentId) ||
        inserted.has(record.parentId),
    );
    const [record] = pending.splice(index < 0 ? 0 : index, 1);
    if (!record) break;
    ordered.push(record);
    inserted.add(record.id);
  }

  const affectedRecordIds = commit ? recordIdsAffectedBy(commit) : undefined;
  const insert = database.prepare(
    `INSERT INTO conversation_records (
       id, conversation_id, agent_id, parent_id, run_id, group_id, sequence,
       revision, kind, status, payload_version, data, created_at_ms, updated_at_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
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
       updated_at_ms = excluded.updated_at_ms`,
  );
  const existingSequence = affectedRecordIds
    ? database.prepare(
        `SELECT sequence FROM conversation_records
         WHERE conversation_id = ? AND id = ?`,
      )
    : undefined;
  let nextSequence = affectedRecordIds
    ? (
        database
          .prepare(
            `SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
             FROM conversation_records WHERE conversation_id = ?`,
          )
          .get(state.conversationId) as { sequence: number }
      ).sequence
    : 1;
  for (const [index, record] of ordered.entries()) {
    if (affectedRecordIds && !affectedRecordIds.has(record.id)) continue;
    const storedSequence = existingSequence?.get(
      state.conversationId,
      record.id,
    ) as { sequence: number } | undefined;
    const sequence =
      storedSequence?.sequence ??
      (affectedRecordIds ? nextSequence++ : index + 1);
    insert.run(
      record.id,
      state.conversationId,
      record.agentId ?? null,
      record.parentId && inserted.has(record.parentId) ? record.parentId : null,
      record.runId ?? null,
      record.groupId ?? null,
      sequence,
      record.revision,
      record.kind,
      record.status,
      encode(record.data),
      Date.parse(record.createdAt),
      Date.parse(record.updatedAt),
    );
  }
  const insertLeaf = database.prepare(
    `INSERT INTO agent_context_leaves (
       conversation_id, agent_id, active_record_id, revision
     ) VALUES (?, ?, ?, ?)
     ON CONFLICT(conversation_id, agent_id) DO UPDATE SET
       active_record_id = excluded.active_record_id,
       revision = excluded.revision`,
  );
  if (state.modelLeafId) {
    insertLeaf.run(
      state.conversationId,
      "agent_conversation",
      known.has(state.modelLeafId) ? state.modelLeafId : null,
      Math.max(1, state.revision),
    );
  }
  for (const [agentId, leafId] of state.agentModelLeafIds) {
    insertLeaf.run(
      state.conversationId,
      agentId,
      leafId && known.has(leafId) ? leafId : null,
      Math.max(1, state.revision),
    );
  }
}

function recordIdsAffectedBy(commit: ConversationJournalCommit): Set<string> {
  const ids = new Set<string>();
  for (const event of commit.events) {
    switch (event.kind) {
      case "conversation.entry_appended":
      case "model_context.entry_appended":
        ids.add(event.entry.id);
        break;
      case "tool_call.upserted":
        ids.add(event.toolCall.id);
        break;
      case "run.transition_committed":
        ids.add(event.transition.runId);
        break;
      case "run.event_delivered":
        ids.add(event.delivery.runId);
        break;
    }
  }
  return ids;
}
