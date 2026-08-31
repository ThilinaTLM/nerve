import type { AgentConfigPatch } from "./agent-config-mutation-queue";

const overrides = $state<{ byAgentId: Record<string, AgentConfigPatch> }>({
  byAgentId: {},
});

export function setAgentConfigOverride(
  agentId: string,
  desired: AgentConfigPatch | undefined,
): void {
  if (desired) overrides.byAgentId[agentId] = desired;
  else delete overrides.byAgentId[agentId];
}

export function agentConfigOverride(
  agentId: string | undefined,
): AgentConfigPatch | undefined {
  return agentId ? overrides.byAgentId[agentId] : undefined;
}
