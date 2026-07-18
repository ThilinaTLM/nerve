import { conversationStream, streamForEvent } from "@nervekit/contracts";
import type { EventEnvelope } from "$lib/api";

/**
 * True when the catalog routes this envelope to its conversation's dense
 * stream. Render-neutral events still need to pass through the conversation
 * reducer so its snapshot cursor remains aligned with protocol delivery.
 */
export function isConversationStreamEvent(
  event: EventEnvelope<Record<string, unknown>>,
): boolean {
  const conversationId = conversationIdFromEvent(event);
  if (!conversationId) return false;
  return (
    streamForEvent(event.type, event.data) ===
    conversationStream(conversationId)
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
