import type {
  ToolCallRecord,
  ValidatedToolArtifact,
} from "@nervekit/contracts";
import {
  projectAgentResult,
  toolDefinitionByName,
  type ProjectedToolResult,
} from "@nervekit/tools";

export function projectToolCallResult(
  toolCall: ToolCallRecord,
  completePayload?: ValidatedToolArtifact,
): ProjectedToolResult {
  const definition = toolDefinitionByName(toolCall.toolName);
  return projectAgentResult(
    {
      toolName: toolCall.toolName,
      args: toolCall.args,
      result: toolCall.result,
      status: toolCall.status,
      phase: toolCall.phase,
      error: toolCall.error,
      errorDetails: toolCall.errorDetails,
      validatedArtifacts: toolCall.validatedArtifacts ?? [],
      completePayload,
    },
    definition?.agentResult,
  );
}
