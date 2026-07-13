import type { EventEnvelope } from "$lib/api";

/**
 * Conversation events routed to the runtime reducer in
 * `conversation-reducers.ts`. `conversation.compacted` and
 * `conversation.navigated` are intentionally handled separately in
 * `conversation-events.ts` via a full view refresh.
 */
export function isConversationRuntimeEvent(type: string): boolean {
  return (
    type === "conversation.entry.appended" ||
    type === "conversation.compaction.started" ||
    type === "conversation.compaction.failed" ||
    type === "conversation.context.updated" ||
    type === "toolCall.updated" ||
    type.startsWith("conversation.prompt.") ||
    type.startsWith("run.") ||
    type.startsWith("conversation.live.")
  );
}

export function conversationIdFromEvent(
  event: EventEnvelope<Record<string, unknown>>,
): string | undefined {
  const conversationId = event.data?.conversationId;
  if (typeof conversationId === "string") return conversationId;
  const entry = event.data?.entry as { conversationId?: unknown } | undefined;
  if (typeof entry?.conversationId === "string") return entry.conversationId;
  const toolCall = event.data?.toolCall as
    | { conversationId?: unknown }
    | undefined;
  if (typeof toolCall?.conversationId === "string")
    return toolCall.conversationId;
  return undefined;
}
