import type { DatabaseSync } from "node:sqlite";
import {
  asyncSubagentCompletionSchema,
  type AsyncSubagentCompletion,
} from "@nervekit/contracts/agents";
import { decode, encode } from "./payload-codecs.js";

/** The run is the idempotency key; delivery progress can only move forwards. */
export class SubagentCompletionDatabase {
  constructor(private readonly database: DatabaseSync) {}

  put(input: AsyncSubagentCompletion): void {
    const record = asyncSubagentCompletionSchema.parse(input);
    const existing = this.database
      .prepare("SELECT data FROM subagent_completions WHERE run_id = ?")
      .get(record.runId);
    const previous = existing
      ? asyncSubagentCompletionSchema.parse(decode(existing.data as Uint8Array))
      : undefined;
    if (
      previous &&
      (previous.childId !== record.childId ||
        previous.leadId !== record.leadId ||
        previous.entryId !== record.entryId)
    ) {
      throw new Error("Subagent completion identity conflict");
    }
    const next = {
      ...record,
      deliveredAt: previous?.deliveredAt ?? record.deliveredAt,
      consumedAt: previous?.consumedAt ?? record.consumedAt,
      wokenAt: previous?.wokenAt ?? record.wokenAt,
      suppressed: Boolean(previous?.suppressed || record.suppressed),
    };
    this.database
      .prepare(`INSERT INTO subagent_completions(run_id, child_id, lead_id, conversation_id, pending, data)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET pending=excluded.pending, data=excluded.data`)
      .run(
        next.runId,
        next.childId,
        next.leadId,
        next.conversationId,
        next.consumedAt || next.suppressed ? 0 : 1,
        encode(next),
      );
  }

  list(leadId?: string): AsyncSubagentCompletion[] {
    const rows = leadId
      ? this.database
          .prepare(
            "SELECT data FROM subagent_completions WHERE lead_id = ? ORDER BY run_id",
          )
          .all(leadId)
      : this.database
          .prepare("SELECT data FROM subagent_completions ORDER BY run_id")
          .all();
    return rows.map((row) =>
      asyncSubagentCompletionSchema.parse(decode(row.data as Uint8Array)),
    );
  }

  removeConversation(conversationId: string): void {
    this.database
      .prepare("DELETE FROM subagent_completions WHERE conversation_id = ?")
      .run(conversationId);
  }
}
