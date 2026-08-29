import type { DatabaseSync } from "node:sqlite";
import type {
  ConversationEntry,
  ConversationInteractionRecord,
  ConversationJournalCommit,
  ConversationRecord,
  ConversationSuspensionRecord,
} from "@nervekit/contracts/conversations";
import type { ToolCallRecord } from "@nervekit/contracts/tools";
import {
  ConversationTreeState,
  type ConversationTreeEntry,
} from "@nervekit/harness/conversation";
import { encode } from "../../infrastructure/persistence/canonical-sqlite/payload-codecs.js";
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
  const interactions = new Map(state.interactions);
  const modelTree = new ConversationTreeState(state.modelEntries);
  modelTree.setLeafId(state.modelLeafId);
  const agentModelLeafIds = new Map(state.agentModelLeafIds);
  const agentModelEntries = new Map(
    state.agentModelEntries.map(([agentId, entries]) => [
      agentId,
      normalizeDetachedAgentCompactions(entries),
    ]),
  );
  const agentModelTrees = new Map(
    [...agentModelEntries].map(([agentId, entries]) => {
      const tree = new ConversationTreeState(entries);
      tree.setLeafId(agentModelLeafIds.get(agentId) ?? null);
      return [agentId, tree] as const;
    }),
  );
  return {
    conversationId: state.conversationId,
    revision: state.revision,
    checksum: state.checksum,
    conversation: state.conversation,
    entries: state.entries,
    modelEntries: state.modelEntries,
    modelLeafId: state.modelLeafId,
    agentModelEntries,
    agentModelLeafIds,
    toolCalls: new Map(state.toolCalls),
    runProjections: new Map(state.runProjections),
    interactions,
    suspensions: new Map(state.suspensions),
    idempotencyKeys: new Map(state.idempotencyKeys),
    intentConversationRevisions: new Map(state.intentConversationRevisions),
    entryById: new Map(state.entries.map((entry) => [entry.id, entry])),
    modelEntryById: new Map(
      state.modelEntries.map((entry) => [entry.id, entry]),
    ),
    agentModelEntryById: new Map(
      [...agentModelEntries].map(([agentId, entries]) => [
        agentId,
        new Map(entries.map((entry) => [entry.id, entry])),
      ]),
    ),
    interactionIdsByToolCall: indexInteractionIds(interactions.values()),
    interactionByToolCallOrdinal: indexInteractionOrdinals(
      interactions.values(),
    ),
    modelTree,
    agentModelTrees,
  };
}

/**
 * Legacy per-agent journals can contain standalone compaction snapshots whose
 * parent belongs to the shared conversation journal. A compaction is a complete
 * context boundary, so detaching that unavailable parent preserves its usable
 * context while keeping all other tree-link failures strict.
 */
export function normalizeDetachedAgentCompactions(
  entries: readonly ConversationTreeEntry[],
): ConversationTreeEntry[] {
  const knownIds = new Set<string>();
  return entries.map((entry) => {
    const normalized =
      entry.type === "compaction" &&
      entry.parentId !== null &&
      !knownIds.has(entry.parentId)
        ? { ...entry, parentId: null }
        : entry;
    knownIds.add(normalized.id);
    return normalized;
  });
}

function interactionOrdinalKey(toolCallId: string, ordinal: number): string {
  return `${toolCallId}:${ordinal}`;
}

function indexInteractionIds(
  interactions: Iterable<ConversationInteractionRecord>,
): Map<string, Set<string>> {
  const indexed = new Map<string, Set<string>>();
  for (const interaction of interactions) {
    const ids = indexed.get(interaction.toolCallId) ?? new Set<string>();
    ids.add(interaction.id);
    indexed.set(interaction.toolCallId, ids);
  }
  return indexed;
}

function indexInteractionOrdinals(
  interactions: Iterable<ConversationInteractionRecord>,
): Map<string, ConversationInteractionRecord> {
  return new Map(
    [...interactions].map((interaction) => [
      interactionOrdinalKey(
        interaction.toolCallId,
        interaction.interaction.ordinal,
      ),
      interaction,
    ]),
  );
}

export interface MaterializedConversationRecord {
  id: string;
  agentId?: string;
  parentId?: string;
  runId?: string;
  groupId?: string;
  kind: "message" | "summary" | "run" | "tool_call" | "tool_batch";
  status: string;
  revision: number;
  payloadVersion?: number;
  data: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationLeafDelta {
  agentId: string;
  activeRecordId: string | null;
  revision: number;
}

export interface ConversationPersistenceDelta {
  conversationId: string;
  previousRevision: number;
  previousChecksum?: string;
  commit: ConversationJournalCommit;
  conversation?: ConversationRecord;
  records: MaterializedConversationRecord[];
  leaves: ConversationLeafDelta[];
}

/** Builds only the relational records named by one journal commit. */
export function prepareConversationPersistenceDelta(
  state: ConversationJournalState,
  commit: ConversationJournalCommit,
  runProjections: ReadonlyMap<string, ConversationRunProjection> = new Map(),
): ConversationPersistenceDelta {
  const transcriptEntries = new Map<string, ConversationEntry>();
  const modelEntries = new Map<
    string,
    { ownerAgentId?: string; entry: ConversationTreeEntry }
  >();
  const toolCalls = new Map<string, ToolCallRecord>();
  const affectedIds = new Set<string>();
  const leaves = new Map<string, ConversationLeafDelta>();
  let conversation: ConversationRecord | undefined;

  for (const event of commit.events) {
    switch (event.kind) {
      case "conversation.upserted":
        conversation = event.conversation;
        break;
      case "conversation.entry_appended":
        if (!state.entryById.has(event.entry.id)) {
          transcriptEntries.set(event.entry.id, event.entry);
          affectedIds.add(event.entry.id);
        }
        break;
      case "model_context.entry_appended": {
        const entry = event.entry as unknown as ConversationTreeEntry;
        modelEntries.set(entry.id, {
          ownerAgentId: event.ownerAgentId,
          entry,
        });
        affectedIds.add(entry.id);
        const activeRecordId =
          entry.type === "leaf" ? entry.targetId : entry.id;
        const agentId = event.ownerAgentId ?? "agent_conversation";
        leaves.set(agentId, {
          agentId,
          activeRecordId,
          revision: commit.revision,
        });
        break;
      }
      case "model_context.leaf_changed": {
        const agentId = event.ownerAgentId ?? "agent_conversation";
        leaves.set(agentId, {
          agentId,
          activeRecordId: event.entryId,
          revision: commit.revision,
        });
        break;
      }
      case "tool_call.upserted":
        toolCalls.set(event.toolCall.id, event.toolCall);
        affectedIds.add(event.toolCall.id);
        break;
      case "run.transition_committed":
        affectedIds.add(event.transition.runId);
        break;
      case "run.event_delivered":
        affectedIds.add(event.delivery.runId);
        break;
    }
  }

  const records: MaterializedConversationRecord[] = [];
  for (const id of affectedIds) {
    const toolCall = toolCalls.get(id);
    if (toolCall) {
      records.push(materializedToolCall(toolCall));
      continue;
    }
    const projection = runProjections.get(id);
    if (projection) {
      records.push(materializedRun(projection));
      continue;
    }
    const transcript = transcriptEntries.get(id) ?? state.entryById.get(id);
    const model = modelEntries.get(id) ?? existingModelEntry(state, id);
    if (transcript || model) {
      records.push(materializedEntry(transcript, model));
    }
  }

  return {
    conversationId: state.conversationId,
    previousRevision: commit.previousRevision,
    previousChecksum: commit.previousChecksum,
    commit,
    conversation,
    records,
    leaves: [...leaves.values()],
  };
}

function existingModelEntry(
  state: ConversationJournalState,
  id: string,
): { ownerAgentId?: string; entry: ConversationTreeEntry } | undefined {
  const global = state.modelEntryById.get(id);
  if (global) return { entry: global };
  for (const [ownerAgentId, entries] of state.agentModelEntryById) {
    const entry = entries.get(id);
    if (entry) return { ownerAgentId, entry };
  }
  return undefined;
}

function materializedEntry(
  transcript: ConversationEntry | undefined,
  model: { ownerAgentId?: string; entry: ConversationTreeEntry } | undefined,
): MaterializedConversationRecord {
  const modelEntry = model?.entry;
  const summary = transcript
    ? transcript.kind === "compaction" || transcript.kind === "branch_summary"
    : modelEntry?.type === "compaction" ||
      modelEntry?.type === "branch_summary";
  const createdAt = transcript?.createdAt ?? modelEntry?.timestamp;
  if (!createdAt) throw new Error("Conversation record has no timestamp.");
  const transcriptData = transcript
    ? summary
      ? {
          version: 1,
          entry: transcript,
          firstRetainedRecordId: transcript.firstKeptEntryId,
          tokensBefore: transcript.tokensBefore,
        }
      : { version: 1, entry: transcript }
    : { version: 1 };
  return {
    id: transcript?.id ?? modelEntry!.id,
    agentId: model?.ownerAgentId ?? transcript?.agentId,
    parentId: modelEntry?.parentId ?? transcript?.parentEntryId,
    runId: transcript?.runId,
    kind: summary ? "summary" : "message",
    status: "completed",
    revision: 1,
    data: modelEntry
      ? {
          ...transcriptData,
          modelContext: {
            visibility: transcript ? "model_and_history" : "model_only",
            entry: modelEntry,
          },
        }
      : transcriptData,
    createdAt,
    updatedAt: modelEntry?.timestamp ?? createdAt,
  };
}

function materializedToolCall(
  toolCall: ToolCallRecord,
): MaterializedConversationRecord {
  return {
    id: toolCall.id,
    agentId: toolCall.agentId,
    runId: toolCall.runId,
    groupId: toolCall.groupId,
    kind: "tool_call",
    status: toolCall.phase ?? toolCall.status,
    revision: toolCall.revision,
    payloadVersion: 2,
    data: { version: 2, toolCall },
    createdAt: toolCall.createdAt,
    updatedAt: toolCall.updatedAt,
  };
}

function materializedRun(
  projection: ConversationRunProjection,
): MaterializedConversationRecord {
  return {
    id: projection.run.runId,
    agentId: projection.run.agentId,
    runId: projection.run.runId,
    kind: "run",
    status: projection.run.status,
    revision: projection.run.revision,
    data: { version: 1, run: projection.run, state: projection },
    createdAt: projection.run.createdAt,
    updatedAt: projection.run.updatedAt,
  };
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

  const records = new Map<string, MaterializedConversationRecord>();
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
      payloadVersion: 2,
      data: { version: 2, toolCall },
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
  const ordered = orderMaterializedRecords(records.values());
  const inserted = new Set(ordered.map((record) => record.id));

  const affectedRecordIds = commit ? recordIdsAffectedBy(commit) : undefined;
  const insert = database.prepare(
    `INSERT INTO conversation_records (
       id, conversation_id, agent_id, parent_id, run_id, group_id, sequence,
       revision, kind, status, payload_version, data, created_at_ms, updated_at_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      record.payloadVersion ?? 1,
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

function orderMaterializedRecords(
  records: Iterable<MaterializedConversationRecord>,
): MaterializedConversationRecord[] {
  const remaining = new Map([...records].map((record) => [record.id, record]));
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
