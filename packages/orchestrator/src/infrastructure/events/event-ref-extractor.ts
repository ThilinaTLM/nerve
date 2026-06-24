import type { EventEnvelope } from "@nervekit/shared";

export function conversationIdForEvent(
  event: EventEnvelope,
): string | undefined {
  const data = event.data as Record<string, unknown> | undefined;
  if (!data) return undefined;
  if (typeof data.conversationId === "string") return data.conversationId;
  const conversation = data.conversation as Record<string, unknown> | undefined;
  if (typeof conversation?.id === "string") return conversation.id;
  const entry = data.entry as Record<string, unknown> | undefined;
  if (typeof entry?.conversationId === "string") return entry.conversationId;
  const toolCall = data.toolCall as Record<string, unknown> | undefined;
  if (typeof toolCall?.conversationId === "string")
    return toolCall.conversationId;
  const agent = data.agent as Record<string, unknown> | undefined;
  if (typeof agent?.conversationId === "string") return agent.conversationId;
  const task = data.task as Record<string, unknown> | undefined;
  if (typeof task?.conversationId === "string") return task.conversationId;
  const question = data.question as Record<string, unknown> | undefined;
  if (typeof question?.conversationId === "string")
    return question.conversationId;
  const planReview = data.planReview as Record<string, unknown> | undefined;
  if (typeof planReview?.conversationId === "string")
    return planReview.conversationId;
  return undefined;
}
