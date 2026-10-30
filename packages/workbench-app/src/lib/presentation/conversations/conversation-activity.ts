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
    | "result-ready"
    | "completed";
  tone: StatusTone;
  pulse: boolean;
  busy: boolean;
  needsUser: boolean;
  clearableFailure?: boolean;
  label?: string;
  /** Short second-line text for states the user should act on or read. */
  statusText?: string;
};

type PendingInput = NonNullable<ConversationSummary["pendingInput"]>;

const pendingInputText: Record<PendingInput["kind"], string> = {
  approval: "Approval needed",
  user_input: "Question for you",
  plan_review: "Plan ready for review",
  configuration_blocked: "Approval needed",
};

/**
 * "Approval needed" for the conversation itself, "<sub-agent> · approval
 * needed" when a descendant raised the request.
 */
export function pendingInputTitle(
  rootId: string,
  pendingInput: PendingInput,
): string {
  const text = pendingInputText[pendingInput.kind];
  return pendingInput.conversationId === rootId
    ? text
    : `${pendingInput.conversationTitle} · ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

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
  options: { resultReady?: boolean } = {},
): ConversationActivity {
  const status = row.status;
  if (status === "waiting" || row.pendingInput !== null)
    return {
      ...idleConversationActivity,
      indicator: "needs-user",
      tone: "warning",
      needsUser: true,
      label: "Needs your attention",
      statusText: row.pendingInput
        ? pendingInputTitle(row.id, row.pendingInput)
        : "Needs your attention",
    };
  if (status === "failed")
    return {
      ...idleConversationActivity,
      indicator: "error",
      tone: "destructive",
      clearableFailure: true,
      label: "Agent error",
      statusText: "Agent failed",
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
  if (row.pendingWork)
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
      tone: "destructive",
      clearableFailure: true,
      label: "Stopped",
      statusText: "Interrupted",
    };
  if (options.resultReady)
    return {
      ...idleConversationActivity,
      indicator: "result-ready",
      tone: "success",
      label: "Finished",
      statusText: "Finished",
    };
  if (row.completedAt)
    return {
      ...idleConversationActivity,
      indicator: "completed",
      label: "Completed",
    };
  return idleConversationActivity;
}
