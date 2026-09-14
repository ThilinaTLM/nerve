import type { DatabaseSync } from "node:sqlite";
import type { ConversationHead } from "@nervekit/contracts/conversations";

export function assertSelectedEntry(
  database: DatabaseSync,
  head: ConversationHead,
): void {
  if (!head.activeEntryId) return;
  const entry = database
    .prepare(
      `SELECT conversation_id FROM conversation_entries WHERE entry_id = ?`,
    )
    .get(head.activeEntryId) as { conversation_id: string } | undefined;
  if (!entry || entry.conversation_id !== head.conversationId) {
    throw new Error("Active entry must exist in the same conversation.");
  }
}

export function validateForegroundOwnership(
  database: DatabaseSync,
  initial: ConversationHead | undefined,
  current: ConversationHead | undefined,
): void {
  if (!current) return;
  if (
    initial?.foregroundRunId &&
    initial.foregroundRunId !== current.foregroundRunId
  ) {
    const prior = database
      .prepare(`SELECT foreground_owned FROM run_controls WHERE run_id = ?`)
      .get(initial.foregroundRunId) as { foreground_owned: number } | undefined;
    if (prior?.foreground_owned !== 0) {
      throw new Error("The prior foreground run must be fenced atomically.");
    }
  }
  if (!current.foregroundRunId) return;
  const owner = database
    .prepare(
      `SELECT conversation_id, bound_selection_epoch, continuation_entry_id,
              foreground_owned
       FROM run_controls WHERE run_id = ?`,
    )
    .get(current.foregroundRunId) as
    | {
        conversation_id: string;
        bound_selection_epoch: number;
        continuation_entry_id: string | null;
        foreground_owned: number;
      }
    | undefined;
  if (
    !owner ||
    owner.conversation_id !== current.conversationId ||
    owner.bound_selection_epoch !== current.selectionEpoch ||
    owner.continuation_entry_id !== current.activeEntryId ||
    owner.foreground_owned !== 1
  ) {
    throw new Error(
      "Foreground run and active continuation head must agree atomically.",
    );
  }
}
