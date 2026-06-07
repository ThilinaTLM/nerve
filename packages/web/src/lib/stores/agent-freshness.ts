import type { AgentRecord } from "../api";

export function isNewerAgent(
  candidate: AgentRecord,
  current: AgentRecord | undefined,
): boolean {
  return !current || candidate.updatedAt >= current.updatedAt;
}

export function mergeAgentsByUpdatedAt(
  incoming: AgentRecord[],
  current: AgentRecord[],
): AgentRecord[] {
  const currentById = new Map(current.map((agent) => [agent.id, agent]));
  return incoming.map((agent) => {
    const existing = currentById.get(agent.id);
    if (!existing || isNewerAgent(agent, existing)) return agent;
    return existing;
  });
}

export function upsertAgentByUpdatedAt(
  incoming: AgentRecord,
  current: AgentRecord[],
): AgentRecord[] {
  const index = current.findIndex((agent) => agent.id === incoming.id);
  if (index === -1) return [...current, incoming];
  const existing = current[index];
  if (!isNewerAgent(incoming, existing)) return current;
  return current.map((agent) => (agent.id === incoming.id ? incoming : agent));
}
