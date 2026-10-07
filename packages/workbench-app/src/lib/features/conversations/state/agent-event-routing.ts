import type { AgentRecord } from "$lib/api";
import { conversationIdFromEvent } from "./conversation-event-routing";
import type { WorkbenchEvent } from "$lib/application/events/event-bus";

/** Agent identity, never a shared legacy conversation, owns transcript routing. */
export function agentIdFromEvent(event: WorkbenchEvent): string | undefined {
  for (const candidate of [
    event.data?.childAgentId,
    event.data?.agentId,
    (event.data?.activity as { agentId?: unknown } | undefined)?.agentId,
    (event.data?.entry as { agentId?: unknown } | undefined)?.agentId,
    (event.data?.toolCall as { agentId?: unknown } | undefined)?.agentId,
    (event.data?.agent as { id?: unknown } | undefined)?.id,
  ]) {
    if (typeof candidate === "string") return candidate;
  }
  return undefined;
}

export function eventTargetsAgent(
  event: WorkbenchEvent,
  agent: Pick<AgentRecord, "id" | "conversationId">,
): boolean {
  if (agentIdFromEvent(event) !== agent.id) return false;
  const conversationId = conversationIdFromEvent(event);
  return !conversationId || conversationId === agent.conversationId;
}
