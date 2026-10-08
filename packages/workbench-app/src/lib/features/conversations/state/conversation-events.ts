const inputRevisions = new Map<string, number>();

import {
  isSequencedEvent,
  onAnyEvent,
  type WorkbenchEvent,
} from "$lib/application/events/event-bus";
import { agentUsesConversationView } from "./agent-history-ownership";
import { agentIdFromEvent, eventTargetsAgent } from "./agent-event-routing";
import { conversationState } from "./conversation-state.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import {
  applyAgentViewEvent,
  applyAgentViewNotification,
  reconcileAgentView,
} from "./agent-selection.svelte";
import { refreshConversationView } from "$lib/features/conversations/state/conversation-flow.svelte";
import {
  conversationIdFromEvent,
  isConversationStreamEvent,
} from "./conversation-event-routing";
import { scheduleContextUsageRefresh } from "./conversation-context-usage";
import {
  handleConversationEvent,
  handleConversationNotification,
  isOpenConversation,
} from "./conversation-reducers";

export function registerConversationEventHandlers(): () => void {
  return onAnyEvent(handleConversationBusEvent);
}

function handleConversationBusEvent(event: WorkbenchEvent): void {
  const conversationId = conversationIdFromEvent(event);
  const agentId = agentIdFromEvent(event);
  const agent = workspaceState.agents.find(
    (candidate) => candidate.id === agentId,
  );
  const agentView = agentId ? conversationState.agentViews[agentId] : undefined;
  if (event.type === "agent.inputs_changed" && agent) {
    const revision = event.data.revision;
    if (
      typeof revision === "number" &&
      Number.isSafeInteger(revision) &&
      revision > (inputRevisions.get(agent.id) ?? -1)
    ) {
      inputRevisions.set(agent.id, revision);
      if (agentView || isOpenConversation(agent.conversationId))
        void reconcileAgentView(agent);
    }
    return;
  }
  if (
    agent &&
    eventTargetsAgent(event, agent) &&
    (agentView ||
      (agentUsesConversationView(agent) &&
        isOpenConversation(agent.conversationId)))
  ) {
    if (
      !agentUsesConversationView(agent) &&
      isSequencedEvent(event) &&
      isConversationStreamEvent(event)
    ) {
      applyAgentViewEvent(agent, event);
    } else if (!agentUsesConversationView(agent) && !isSequencedEvent(event)) {
      applyAgentViewNotification(agent, event);
    }
    if (
      event.type.includes("completed") ||
      event.type.includes("failed") ||
      event.type.includes("aborted") ||
      event.type.includes("cancelled") ||
      event.type.startsWith("agent.prompt") ||
      event.type === "agent.configured" ||
      event.type === "agent.activity_changed"
    ) {
      void reconcileAgentView(agent);
    }
  }
  if (!isSequencedEvent(event)) {
    if (conversationId && isOpenConversation(conversationId)) {
      handleConversationNotification(event);
    }
    return;
  }
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
