import type { AgentRecord, CreateAgentRequest } from "@nerve/shared";

export function agentBudget(
  parent: AgentRecord | undefined,
  request: CreateAgentRequest["budget"],
): AgentRecord["budget"] {
  if (!parent) {
    return {
      depth: request?.depth ?? 0,
      maxDepth: request?.maxDepth ?? 3,
      maxRuns: request?.maxRuns ?? 8,
      usedRuns: request?.usedRuns ?? 0,
    };
  }
  return {
    depth: parent.budget.depth + 1,
    maxDepth: request?.maxDepth ?? parent.budget.maxDepth,
    maxRuns: request?.maxRuns ?? Math.max(1, parent.budget.maxRuns),
    usedRuns: request?.usedRuns ?? 0,
  };
}
