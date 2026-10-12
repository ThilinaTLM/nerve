import type {
  ConversationSnapshot,
  TransferredConversationEvent,
} from "@nervekit/contracts/core";

/** Queue membership is delivery state, not necessarily waiting behind work. */
export function promptPresentations(
  snapshot: Pick<ConversationSnapshot, "queue" | "toolCalls">,
  events: readonly TransferredConversationEvent[],
): ReadonlyMap<string, "starting" | "waiting"> {
  const result = new Map<string, "starting" | "waiting">();
  const inputs = [...snapshot.queue].sort(
    (a, b) => a.acceptanceSequence - b.acceptanceSequence,
  );
  for (const [index, input] of inputs.entries()) {
    let executing = false;
    for (const event of events) {
      // A start caused by this submission must not turn its bubble into queued.
      if (event.createdAt >= input.acceptedAt) continue;
      if (
        event.type !== "system_event" ||
        event.payload.subtype !== "execution_state"
      )
        continue;
      executing = !["completed", "failed", "cancelled", "interrupted"].includes(
        event.payload.transition,
      );
    }
    // Queue delivery is blocked by unresolved tool calls. The starter itself
    // cannot create model tool calls until it has left the input queue.
    const blocked = snapshot.toolCalls.length > 0;
    // Another input consumed after this one was accepted was ahead of it, even
    // if both were accepted before the scheduler emitted execution_started.
    const deliveredAhead = events.some(
      (event) =>
        event.type === "user_message" &&
        event.inputId !== input.inputId &&
        event.createdAt >= input.acceptedAt,
    );
    result.set(
      input.inputId,
      index > 0 || executing || blocked || deliveredAhead
        ? "waiting"
        : "starting",
    );
  }
  return result;
}
