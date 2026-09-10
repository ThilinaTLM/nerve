import type {
  ApprovalRecord,
  ToolCallRecord,
  ToolCallTranscriptRecord,
  UserQuestionRecord,
  UserQuestionStatus,
} from "@nervekit/contracts/tools";
type InteractionActionable = (
  toolCall: ToolCallRecord | ToolCallTranscriptRecord,
  ordinal: number,
) => boolean;
function durableApprovalScopes(
  scopes: readonly string[],
): Array<
  "single_call" | "always_conversation" | "always_project" | "always_user"
> {
  const mapped = scopes.map((scope) =>
    scope === "always" ? "always_user" : scope,
  );
  return [...new Set(mapped)].filter(
    (
      scope,
    ): scope is
      | "single_call"
      | "always_conversation"
      | "always_project"
      | "always_user" =>
      scope === "single_call" ||
      scope === "always_conversation" ||
      scope === "always_project" ||
      scope === "always_user",
  );
}
export function projectApproval(
  toolCall: ToolCallRecord | ToolCallTranscriptRecord,
  ordinal: number,
): ApprovalRecord {
  const interaction = toolCall.interactions[ordinal];
  if (!interaction || interaction.kind !== "approval")
    throw new Error("Approval interaction not found.");
  return {
    id: `approval_${toolCall.id}_${ordinal}`,
    toolCallId: toolCall.id,
    agentId: toolCall.agentId,
    conversationId: toolCall.conversationId,
    projectId: toolCall.projectId,
    risk: interaction.request.risk,
    reason: interaction.request.reason,
    status:
      interaction.status === "pending"
        ? "pending"
        : interaction.resolution?.action === "allow"
          ? "granted"
          : "denied",
    requestedAt: interaction.requestedAt,
    resolvedAt: interaction.resolvedAt,
    resolutionNote: interaction.resolution?.note,
    offeredScopes: durableApprovalScopes(interaction.request.offeredScopes),
    suggestedExceptions: interaction.request.suggestedExceptions,
    suggestedRules: interaction.request.suggestedRules,
    permissionRuleSetId: interaction.request.permissionRuleSetId,
  };
}
export function projectApprovals(
  toolCalls: readonly (ToolCallRecord | ToolCallTranscriptRecord)[],
  isActionable: InteractionActionable,
  status?: ApprovalRecord["status"],
): ApprovalRecord[] {
  return toolCalls
    .flatMap((toolCall) =>
      toolCall.interactions.flatMap((interaction) =>
        interaction.kind === "approval" &&
        (interaction.status !== "pending" ||
          isActionable(toolCall, interaction.ordinal))
          ? [projectApproval(toolCall, interaction.ordinal)]
          : [],
      ),
    )
    .filter((approval) => status === undefined || approval.status === status);
}
export function projectQuestions(
  toolCalls: readonly (ToolCallRecord | ToolCallTranscriptRecord)[],
  isActionable: InteractionActionable,
  status?: UserQuestionStatus,
): UserQuestionRecord[] {
  return toolCalls
    .flatMap((toolCall) =>
      toolCall.interactions.flatMap((interaction) => {
        if (
          interaction.kind !== "user_input" ||
          (interaction.status === "pending" &&
            !isActionable(toolCall, interaction.ordinal))
        )
          return [];
        const projected: UserQuestionRecord = {
          id: `question_${toolCall.id}_${interaction.ordinal}`,
          toolCallId: toolCall.id,
          agentId: toolCall.agentId,
          conversationId: toolCall.conversationId,
          projectId: toolCall.projectId,
          question: interaction.request.question,
          context: interaction.request.context,
          recommendation: interaction.request.recommendation,
          status:
            interaction.status === "pending"
              ? "pending"
              : interaction.resolution?.action === "answer"
                ? "answered"
                : "dismissed",
          answer:
            interaction.resolution?.action === "answer"
              ? interaction.resolution.answer
              : undefined,
          dismissedReason:
            interaction.resolution?.action === "dismiss"
              ? interaction.resolution.reason
              : undefined,
          requestedAt: interaction.requestedAt,
          resolvedAt: interaction.resolvedAt,
          updatedAt: interaction.updatedAt,
        };
        return [projected];
      }),
    )
    .filter((question) => status === undefined || question.status === status);
}
