import type { ConversationSummary } from "@nervekit/contracts/core";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
export type ConversationActivity = {
  indicator: "idle" | "running" | "needs-user" | "error" | "aborted";
  tone: StatusTone;
  pulse: boolean;
  busy: boolean;
  needsUser: boolean;
  clearableFailure?: boolean;
  label?: string;
  source: "summary";
};
export const idleConversationActivity: ConversationActivity = {
  indicator: "idle",
  tone: "neutral",
  pulse: false,
  busy: false,
  needsUser: false,
  source: "summary",
};
export function summaryActivity(
  row: ConversationSummary,
): ConversationActivity {
  const status =
    row.statusClearedAt &&
    (row.status === "failed" || row.status === "interrupted")
      ? "idle"
      : row.status;
  if (status === "idle") return idleConversationActivity;
  return {
    indicator:
      status === "failed"
        ? "error"
        : status === "waiting"
          ? "needs-user"
          : status === "interrupted"
            ? "aborted"
            : status,
    tone:
      status === "running"
        ? "info"
        : status === "failed"
          ? "destructive"
          : "warning",
    pulse: status === "running",
    busy: status === "running",
    needsUser: status === "waiting",
    clearableFailure: status === "failed" || status === "interrupted",
    label: status,
    source: "summary",
  };
}
