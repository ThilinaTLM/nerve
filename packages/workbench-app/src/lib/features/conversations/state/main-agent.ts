import type { AgentRecord, ConversationRecord } from "$lib/api";

export function mainAgentForConversation(
  conversation: ConversationRecord,
  agents: AgentRecord[],
  selectedAgentId?: string,
): AgentRecord | undefined {
  const selected = selectedAgentId
    ? agents.find((agent) => agent.id === selectedAgentId)
    : undefined;
  const active = conversation.activeAgentId
    ? agents.find((agent) => agent.id === conversation.activeAgentId)
    : undefined;

  for (const candidate of [selected, active]) {
    if (!candidate || candidate.conversationId !== conversation.id) continue;
    if (!candidate.parentAgentId) return candidate;
    const root = agents.find(
      (agent) =>
        agent.id === candidate.rootAgentId &&
        !agent.parentAgentId &&
        agent.conversationId === conversation.id,
    );
    if (root) return root;
  }

  return agents
    .filter(
      (agent) =>
        agent.conversationId === conversation.id && !agent.parentAgentId,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}
