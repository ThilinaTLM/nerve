import type { ConversationSummary } from "./conversation.js";

type RecencyFields = Pick<
  ConversationSummary,
  "id" | "createdAt" | "lastUserMessageAt"
>;

/** Recency is the last actual user prompt, falling back to creation time. */
export function conversationLastUserPromptAt(
  conversation: Pick<ConversationSummary, "lastUserMessageAt" | "createdAt">,
): string {
  return conversation.lastUserMessageAt ?? conversation.createdAt;
}

/** Most recent user prompt first; creation time and id keep the order stable. */
export function compareConversationsByLastUserPromptDesc(
  a: RecencyFields,
  b: RecencyFields,
): number {
  return (
    conversationLastUserPromptAt(b).localeCompare(
      conversationLastUserPromptAt(a),
    ) ||
    b.createdAt.localeCompare(a.createdAt) ||
    a.id.localeCompare(b.id)
  );
}
