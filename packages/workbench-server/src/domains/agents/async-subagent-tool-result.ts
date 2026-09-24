import type {
  AsyncSubagentListDetails,
  AsyncSubagentPromptDetails,
  AsyncSubagentView,
} from "@nervekit/contracts/agents";

export type AsyncSubagentToolDetails =
  | AsyncSubagentView
  | AsyncSubagentPromptDetails
  | AsyncSubagentListDetails;

function withoutAgentId<T extends { agentId: string }>(
  value: T,
): Omit<T, "agentId"> {
  const { agentId: _agentId, ...rest } = value;
  void _agentId;
  return rest;
}

/**
 * Teammates are addressed by name, so the model-facing content omits the child
 * agent ids that `details` carries for the UI (transcript links).
 */
export function subagentToolResult(details: AsyncSubagentToolDetails): {
  details: AsyncSubagentToolDetails;
  content: string;
} {
  const modelView =
    "subagents" in details
      ? { ...details, subagents: details.subagents.map(withoutAgentId) }
      : withoutAgentId(details);
  return { details, content: JSON.stringify(modelView) };
}
