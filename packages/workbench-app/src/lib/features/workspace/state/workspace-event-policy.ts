import type { AgentRecord } from "$lib/api";

export function runtimeAgentStatusFromEvent(
  type: string,
  data?: Record<string, unknown>,
): AgentRecord["status"] | undefined {
  switch (type) {
    case "run.started":
    case "run.resumed":
    case "run.retrying":
      return "running";
    case "run.waiting":
    case "run.suspended":
      return "awaiting_user";
    case "run.completed":
      return "idle";
    case "run.cancelled":
      return "aborted";
    case "run.failed":
      return data?.aborted ? "aborted" : "error";
    default:
      return undefined;
  }
}

/**
 * Snapshot refreshes are reserved for event families whose payloads cannot
 * fully project workspace state locally. Interaction events (approval.*,
 * userQuestion.*, planReview.*), agent configuration/status/mode events, and
 * run lifecycle events all carry complete records or derivable statuses and
 * are reconciled by the entity reducers, so they must not trigger a delayed
 * blanket snapshot that could undo optimistic local state.
 */
export function shouldRefreshWorkspace(type: string): boolean {
  return (
    type === "conversation.created" ||
    type === "conversation.updated" ||
    type === "conversation.deleted" ||
    type === "conversation.compacted" ||
    type === "conversation.branch_summarized" ||
    type === "conversation.navigated" ||
    type === "project.deleted" ||
    type === "agent.created" ||
    type.startsWith("agent.subagent_") ||
    type.startsWith("agent.explore_") ||
    type === "project.created" ||
    type === "plan.written" ||
    type === "toolCall.updated" ||
    type.startsWith("task.") ||
    shouldRefreshSettings(type)
  );
}

export function shouldRefreshSettings(type: string): boolean {
  return (
    type.startsWith("settings.") ||
    type.startsWith("secrets.") ||
    type.startsWith("auth.") ||
    type.startsWith("providers.")
  );
}
