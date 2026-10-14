import type { ConversationSummary } from "@nervekit/contracts/core";
import type { StatusTone } from "@nervekit/ui-kit/display/status";

/** Shared product meaning; tab presence only affects how dots are rendered. */
export type ConversationActivity = {
  indicator:
    | "idle"
    | "running"
    | "needs-user"
    | "awaiting-async"
    | "error"
    | "aborted"
    | "completed";
  tone: StatusTone;
  pulse: boolean;
  busy: boolean;
  needsUser: boolean;
  clearableFailure?: boolean;
  label?: string;
};

export const idleConversationActivity: ConversationActivity = {
  indicator: "idle",
  tone: "neutral",
  pulse: false,
  busy: false,
  needsUser: false,
  clearableFailure: false,
  label: "Idle",
};

export function summaryActivity(
  row: ConversationSummary,
  awaitingAsync = false,
): ConversationActivity {
  const status =
    row.statusClearedAt &&
    (row.status === "failed" || row.status === "interrupted")
      ? "idle"
      : row.status;
  // Summary waiting means an unresolved tool approval or human input request.
  if (status === "waiting")
    return {
      ...idleConversationActivity,
      indicator: "needs-user",
      tone: "warning",
      needsUser: true,
      label: "Needs your attention",
    };
  if (status === "failed")
    return {
      ...idleConversationActivity,
      indicator: "error",
      tone: "destructive",
      clearableFailure: true,
      label: "Agent error",
    };
  if (status === "running")
    return {
      ...idleConversationActivity,
      indicator: "running",
      tone: "info",
      pulse: true,
      busy: true,
      label: "Agent running",
    };
  if (awaitingAsync)
    return {
      ...idleConversationActivity,
      indicator: "awaiting-async",
      tone: "info",
      label: "Waiting for subagents or background commands",
    };
  if (status === "interrupted")
    return {
      ...idleConversationActivity,
      indicator: "aborted",
      clearableFailure: true,
      label: "Stopped",
    };
  if (row.completedAt)
    return {
      ...idleConversationActivity,
      indicator: "completed",
      label: "Completed",
    };
  return idleConversationActivity;
}
