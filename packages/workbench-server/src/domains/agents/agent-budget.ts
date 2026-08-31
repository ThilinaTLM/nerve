import type {
  AgentRecord,
  CreateAgentRequest,
} from "@nervekit/contracts/agents";

export function agentBudget(
  parent: AgentRecord | undefined,
  request: CreateAgentRequest["budget"],
): AgentRecord["budget"] {
  if (!parent) {
    return {
      depth: request?.depth ?? 0,
      maxDepth: request?.maxDepth ?? 3,
    };
  }
  return {
    depth: parent.budget.depth + 1,
    maxDepth: request?.maxDepth ?? parent.budget.maxDepth,
  };
}
