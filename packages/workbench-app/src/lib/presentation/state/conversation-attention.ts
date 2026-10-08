import type { RecoveryIssue } from "@nervekit/contracts/runs";
import type { TimelineItem } from "./timeline.js";

/** UI-only attention rows belong to the scrollable transcript, never model context. */
export function conversationAttentionRows(input: {
  recoveryIssues?: readonly RecoveryIssue[];
  readOnly?: boolean;
  stale?: boolean;
  fallbackReason?: string;
  error?: string;
}): TimelineItem[] {
  const rows: TimelineItem[] = [];
  if (input.recoveryIssues?.length) {
    const issues = input.recoveryIssues;
    rows.push({
      kind: "system_event",
      key: `recovery:${issues.map((issue) => issue.id).join(":")}`,
      notice: {
        entryId: `recovery:${issues[0].id}`,
        kind: "message",
        createdAt: issues[0].createdAt,
        details: { type: "recovery_attention" },
        text: `${issues.map((issue) => issue.message).join("\n")} ${issues.some((issue) => issue.code === "outcome_unknown") ? "Nerve did not repeat the operation. " : ""}Inspect the affected transcript entries${issues.some((issue) => issue.actions.includes("authorize_retry")) ? ", then cancel or explicitly authorize another attempt" : " before taking further action"}.`,
      },
    });
  }
  if (input.error)
    rows.push({
      kind: "system_event",
      key: "conversation-error",
      notice: {
        entryId: "conversation-error",
        kind: "message",
        createdAt: "1970-01-01T00:00:00.000Z",
        details: { type: "conversation_error" },
        text: input.error,
      },
    });
  if (input.readOnly || input.stale)
    rows.push({
      kind: "system_event",
      key: "snapshot-attention",
      notice: {
        entryId: "snapshot-attention",
        kind: "message",
        createdAt: "1970-01-01T00:00:00.000Z",
        details: {
          type: input.readOnly ? "snapshot_read_only" : "snapshot_stale",
        },
        text: `${input.readOnly ? "Read-only snapshot." : "Conversation may be stale."}${input.fallbackReason ? ` ${input.fallbackReason}` : ""}`,
      },
    });
  return rows;
}
