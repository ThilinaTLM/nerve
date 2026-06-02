import type { AgentRecord } from "@nerve/shared";

export function nerveSystemContext(agent: AgentRecord): string {
  const childContext = agent.parentAgentId
    ? `Parent agent: ${agent.parentAgentId}. Root agent: ${agent.rootAgentId}.`
    : `Root agent: ${agent.rootAgentId}.`;
  return [
    "Nerve orchestration context:",
    `- Mode: ${agent.mode}. Permission level: ${agent.permissionLevel}.`,
    `- ${childContext}`,
    `- Child budget: depth ${agent.budget.depth}/${agent.budget.maxDepth}, runs ${agent.budget.usedRuns}/${agent.budget.maxRuns}.`,
    "- Tool calls may be approved, denied, or constrained according to mode and permission level.",
  ].join("\n");
}
