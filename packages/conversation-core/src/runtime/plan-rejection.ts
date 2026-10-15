import type { ConversationEvent } from "@nervekit/contracts/core";

export function hasRejectedPlan(events: ConversationEvent[]): boolean {
  return events.some(
    (event) =>
      event.type === "tool_call_response" &&
      event.payload.outcome === "completed" &&
      event.payload.interactionResolution?.kind === "plan_review" &&
      event.payload.interactionResolution.decision === "reject",
  );
}
