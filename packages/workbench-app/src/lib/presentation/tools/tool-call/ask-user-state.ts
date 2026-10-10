import type {
  ToolCallTranscriptRecord,
  UserQuestionRecord,
} from "$lib/presentation/view-models/conversation";

type AskUserToolCall = Pick<
  ToolCallTranscriptRecord,
  | "id"
  | "agentId"
  | "conversationId"
  | "projectId"
  | "toolName"
  | "status"
  | "interaction"
>;

/**
 * Resolves the pending question owned by an ask_user card.
 *
 * Transcript tool calls and workspace interaction projections update through
 * separate stores. Deriving from the durable interaction keeps the card usable
 * during the brief handoff before the external projection arrives.
 */
export function resolveAskUserQuestion(
  toolCall: AskUserToolCall | undefined,
  projected: UserQuestionRecord | undefined,
): UserQuestionRecord | undefined {
  if (toolCall?.toolName !== "ask_user" || toolCall.status !== "waiting") {
    return undefined;
  }
  const interaction = toolCall.interaction;
  if (interaction?.kind !== "user_input" || interaction.status !== "pending")
    return undefined;

  if (projected?.toolCallId === toolCall.id && projected.status === "pending") {
    return projected;
  }

  return {
    toolCallId: toolCall.id,
    agentId: toolCall.agentId,
    conversationId: toolCall.conversationId,
    projectId: toolCall.projectId,
    question: interaction.request.question,
    context: interaction.request.context,
    recommendation: interaction.request.recommendation,
    status: "pending",
    requestedAt: interaction.requestedAt,
    updatedAt: interaction.updatedAt,
  };
}
