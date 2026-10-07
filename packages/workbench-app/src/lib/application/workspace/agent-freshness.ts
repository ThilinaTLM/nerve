import type { AgentRecord } from "$lib/api";

export function isNewerAgent(
  candidate: AgentRecord,
  current: AgentRecord | undefined,
): boolean {
  if (!current) return true;
  const accepted = candidate.configurationRevision ?? 1;
  const currentAccepted = current.configurationRevision ?? 1;
  if (accepted !== currentAccepted) return accepted > currentAccepted;
  const effective = candidate.effectiveConfigurationRevision ?? 0;
  const currentEffective = current.effectiveConfigurationRevision ?? 0;
  if (effective !== currentEffective) return effective > currentEffective;
  return candidate.updatedAt >= current.updatedAt;
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
