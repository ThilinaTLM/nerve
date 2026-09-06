import type { DatabaseSync } from "node:sqlite";

const phases = [
  "events",
  "leaves",
  "parent_links",
  "record_projections",
  "tool_projections",
  "records",
  "snapshots",
  "journal_heads",
  "journal_commits",
  "metadata",
  "complete",
] as const;
export type ConversationDeletionPhase = (typeof phases)[number];
export interface ConversationDeletionCursor {
  phase: ConversationDeletionPhase;
  afterSequence?: number;
}
export interface ConversationDeletionChunk {
  done: boolean;
  phase: ConversationDeletionPhase;
  removed: number;
  detached: number;
  next: ConversationDeletionCursor;
}
export interface ConversationDeletionProgress {
  phase: ConversationDeletionPhase;
  removed: number;
  detached: number;
}

/** One bounded transaction. No history payloads are decoded or materialized. */
export function deleteConversationChunk(
  database: DatabaseSync,
  conversationId: string,
  requestedLimit: number,
  cursor: ConversationDeletionCursor = { phase: "events" },
): ConversationDeletionChunk {
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    throw new Error("Conversation deletion limit must be a positive integer.");
  }
  const limit = Math.min(requestedLimit, 500);
  const phase = cursor.phase;
  let removed = 0;
  let detached = 0;
  let next = cursor;
  if (phase === "parent_links") {
    // Keyset over the indexed sequence, not a repeated scan of detached rows.
    const rows = database
      .prepare(`SELECT id, sequence FROM conversation_records
      WHERE conversation_id = ? AND sequence > ? ORDER BY sequence LIMIT ?`)
      .all(conversationId, cursor.afterSequence ?? 0, limit);
    const detach = database.prepare(
      "UPDATE conversation_records SET parent_id = NULL WHERE id = ? AND parent_id IS NOT NULL",
    );
    for (const row of rows)
      detached += Number(detach.run(String(row.id)).changes);
    if (rows.length > 0) {
      return {
        done: false,
        phase,
        removed,
        detached,
        next: { phase, afterSequence: Number(rows.at(-1)?.sequence) },
      };
    }
  } else if (phase !== "complete") {
    const tables = {
      events: "durable_events",
      leaves: "agent_context_leaves",
      record_projections: "conversation_record_projections",
      tool_projections: "tool_call_projections",
      records: "conversation_records",
    } as const;
    if (
      phase === "events" ||
      phase === "leaves" ||
      phase === "record_projections" ||
      phase === "tool_projections" ||
      phase === "records"
    ) {
      const table = tables[phase as keyof typeof tables];
      removed = Number(
        database
          .prepare(`DELETE FROM ${table} WHERE rowid IN (
        SELECT rowid FROM ${table} WHERE conversation_id = ? LIMIT ?
      )`)
          .run(conversationId, limit).changes,
      );
    } else if (phase === "metadata") {
      removed = Number(
        database
          .prepare(`DELETE FROM domain_documents WHERE rowid IN (
        SELECT rowid FROM domain_documents WHERE namespace = 'conversation' AND scope_id = ? AND document_id = ? LIMIT ?
      )`)
          .run("global", conversationId, limit).changes,
      );
    } else {
      const namespace = {
        snapshots: "conversation_state",
        journal_heads: "conversation_journal_head",
        journal_commits: "conversation_journal_commit",
      }[phase];
      removed = Number(
        database
          .prepare(`DELETE FROM domain_documents WHERE rowid IN (
        SELECT rowid FROM domain_documents WHERE namespace = ? AND scope_id = ? LIMIT ?
      )`)
          .run(namespace, conversationId, limit).changes,
      );
    }
  }
  if (removed === 0 && phase !== "complete")
    next = { phase: phases[phases.indexOf(phase) + 1]! };
  return { done: phase === "complete", phase, removed, detached, next };
}
