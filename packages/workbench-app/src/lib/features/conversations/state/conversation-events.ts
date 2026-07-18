import {
  isSequencedEvent,
  onAnyEvent,
  type WorkbenchEvent,
} from "$lib/core/events/event-bus";
import { refreshConversationView } from "$lib/features/conversations/state/conversation-flow.svelte";
import {
  conversationIdFromEvent,
  isConversationStreamEvent,
} from "./conversation-event-routing";
import { scheduleContextUsageRefresh } from "./conversation-context-usage";
import {
  handleConversationEvent,
  isOpenConversation,
} from "./conversation-reducers";

export function registerConversationEventHandlers(): () => void {
  return onAnyEvent(handleConversationBusEvent);
}

function handleConversationBusEvent(event: WorkbenchEvent): void {
  if (!isSequencedEvent(event)) return;
  const conversationId = conversationIdFromEvent(event);
  if (
    conversationId &&
    isOpenConversation(conversationId) &&
    isConversationStreamEvent(event)
  ) {
    // Every event on the dense stream must be consumed, including catalog
    // events with no transcript projection (for example run.checkpointed and
    // policy.evaluated), or the render cursor will falsely report a gap.
    handleConversationEvent(event);
    if (
      event.type === "conversation.compacted" ||
      event.type === "conversation.navigated"
    ) {
      void refreshConversationView(conversationId);
    }
    return;
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
