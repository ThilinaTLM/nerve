import type {
  ToolCallRecord,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts";

const CREDENTIAL_URL = /^[a-z][a-z0-9+.-]*:\/\/[^/\s]*@/i;

export function boundedToolError(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  if (CREDENTIAL_URL.test(value)) {
    return "[Credential-bearing error text omitted; open details.]";
  }
  return value.slice(0, 2_048);
}

export function metadataOnlyToolCallPreview(
  toolCall: ToolCallRecord,
): ToolCallTranscriptRecord {
  return {
    id: toolCall.id,
    agentId: toolCall.agentId,
    conversationId: toolCall.conversationId,
    projectId: toolCall.projectId,
    toolName: toolCall.toolName,
    risk: toolCall.risk,
    cwd: CREDENTIAL_URL.test(toolCall.cwd || "")
      ? "."
      : (toolCall.cwd || ".").slice(0, 2_048),
    status: toolCall.status,
    hidden: toolCall.hidden,
    approvalId: toolCall.approvalId,
    suspensionId: toolCall.suspensionId,
    error: boundedToolError(toolCall.error),
    errorDetails: toolCall.errorDetails
      ? {
          code: toolCall.errorDetails.code.slice(0, 128),
          message:
            boundedToolError(toolCall.errorDetails.message) ?? "Tool failed.",
          retryable: toolCall.errorDetails.retryable,
        }
      : undefined,
    createdAt: toolCall.createdAt,
    updatedAt: toolCall.updatedAt,
  };
}
