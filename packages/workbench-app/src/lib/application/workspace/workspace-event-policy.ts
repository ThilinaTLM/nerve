/**
 * Snapshot refreshes are reserved for event families whose payloads cannot
 * fully project workspace state locally. Activity-change and entity events
 * carry complete replacement records and are applied by entity reducers.
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
    type === "agent.subagent_started" ||
    type === "agent.subagent_completed" ||
    type.startsWith("agent.explore_") ||
    type === "project.created" ||
    type === "plan.written" ||
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
