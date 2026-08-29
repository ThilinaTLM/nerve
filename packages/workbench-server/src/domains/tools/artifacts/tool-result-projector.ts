import type {
  ToolCallRecord,
  ValidatedToolArtifact,
} from "@nervekit/contracts/tools";
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
      denialSource: denialSource(toolCall),
      validatedArtifacts: toolCall.validatedArtifacts ?? [],
      completePayload,
    },
    definition?.agentResult,
  );
}

function denialSource(toolCall: ToolCallRecord): "user" | "policy" | undefined {
  if (toolCall.status !== "denied") return undefined;
  if (toolCall.supervision?.source === "user") return "user";
  if (
    toolCall.supervision?.source === "policy" ||
    toolCall.permissionEvaluation?.decision === "deny"
  ) {
    return "policy";
  }
  return undefined;
}
