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
    case "run.failed":
      return data?.aborted ? "aborted" : "error";
    default:
      return undefined;
  }
}

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
    type === "agent.configured" ||
    type === "agent.status_changed" ||
    type.startsWith("agent.subagent_") ||
    type.startsWith("agent.explore_") ||
    type === "project.created" ||
    type.startsWith("approval.") ||
    type.startsWith("userQuestion.") ||
    type.startsWith("planReview.") ||
    type === "plan.written" ||
    type === "agent.mode_changed" ||
    type === "toolCall.updated" ||
    type === "run.started" ||
    type === "run.resumed" ||
    type === "run.retrying" ||
    type === "run.waiting" ||
    type === "run.completed" ||
    type === "run.failed" ||
    type === "run.suspended" ||
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
