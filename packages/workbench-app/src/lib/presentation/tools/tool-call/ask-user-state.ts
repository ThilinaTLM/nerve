import type {
  ToolCallTranscriptRecord,
  UserQuestionRecord,
} from "@nervekit/contracts/tools";

type AskUserToolCall = Pick<
  ToolCallTranscriptRecord,
  | "id"
  | "agentId"
  | "conversationId"
  | "projectId"
  | "toolName"
  | "status"
  | "interactions"
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
  const interaction = toolCall.interactions.find(
    (candidate) => candidate.status === "pending",
  );
  if (!interaction || interaction.kind !== "user_input") return undefined;

  const questionId = `question_${toolCall.id}_${interaction.ordinal}`;
  if (projected?.id === questionId && projected.status === "pending") {
    return projected;
  }

  return {
    id: questionId,
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
