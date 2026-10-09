import type { AgentRecord } from "$lib/api";

/** Only the persisted legacy lead binding uses the ordinary conversation tree. */
export function agentUsesConversationView(
  agent: Pick<AgentRecord, "contextOwnerAgentId" | "parentAgentId">,
): boolean {
  return (
    !agent.parentAgentId &&
    (agent.contextOwnerAgentId === null ||
      agent.contextOwnerAgentId === undefined)
  );
}
