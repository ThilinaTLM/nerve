import type { EventEnvelope } from "$lib/api";
import { onAnyEvent } from "$lib/core/events/event-bus";
import { refreshConversationView } from "$lib/features/conversations/state/conversation-flow.svelte";
import {
  conversationIdFromEvent,
  isConversationRuntimeEvent,
} from "./conversation-event-routing";
import { scheduleContextUsageRefresh } from "./conversation-context-usage";
import {
  handleConversationEvent,
  isOpenConversation,
} from "./conversation-reducers";

export function registerConversationEventHandlers(): () => void {
  return onAnyEvent(handleConversationBusEvent);
}

function handleConversationBusEvent(
  event: EventEnvelope<Record<string, unknown>>,
): void {
  if (isConversationRuntimeEvent(event.type)) {
    handleConversationEvent(event);
    return;
  }

  if (
    event.type === "conversation.compacted" ||
    event.type === "conversation.navigated"
  ) {
    const conversationId = conversationIdFromEvent(event);
    if (conversationId && isOpenConversation(conversationId)) {
      if (event.type === "conversation.compacted") {
        // The shared reducer records the compaction entry and clears the
        // transient compaction notice before the authoritative refresh lands.
        handleConversationEvent(event);
      }
      void refreshConversationView(conversationId);
    }
  }

  if (event.type === "agent.configured") {
    // This event owns the coalesced context-usage refresh after model or
    // thinking changes; rapid reconfigurations collapse into one request.
    const agent = event.data?.agent as { conversationId?: unknown } | undefined;
    if (typeof agent?.conversationId === "string") {
      scheduleContextUsageRefresh(agent.conversationId);
    }
  }
}
