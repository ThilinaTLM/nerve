import type {
  ConversationHead,
  ConversationTransition,
} from "@nervekit/contracts/conversations";

const appendKinds = new Set([
  "entries_appended",
  "context_boundary_committed",
  "interaction_changed",
  "run_changed",
  "execution_changed",
]);

export function validateTransitionHeadChange(
  current: ConversationHead,
  transition: ConversationTransition,
): void {
  if (current.conversationId !== transition.conversationId) {
    throw new Error("Transition and current head have different owners.");
  }
  if (transition.revision !== current.revision + 1) {
    throw new Error("Transition is not the next conversation revision.");
  }
  const result = transition.resultingHead;
  if (transition.kind === "history_imported") return;

  if (transition.kind === "selection_changed") {
    if (transition.entries.length > 0) {
      throw new Error("Selection transitions cannot append entries.");
    }
    if (result.activeEntryId === current.activeEntryId) {
      throw new Error("Selecting the current head is a no-op.");
    }
    if (result.selectionEpoch !== current.selectionEpoch + 1) {
      throw new Error("Selection changes must increment the selection epoch.");
    }
    if (result.foregroundRunId !== null) {
      throw new Error("Selection changes must fence the foreground owner.");
    }
    return;
  }

  if (result.selectionEpoch !== current.selectionEpoch) {
    throw new Error(
      "Only selection changes may increment the selection epoch.",
    );
  }
  if (transition.entries.length === 0) {
    if (result.activeEntryId !== current.activeEntryId) {
      throw new Error("A non-entry transition cannot move the active head.");
    }
    return;
  }
  if (!appendKinds.has(transition.kind)) {
    throw new Error(`${transition.kind} cannot append entries.`);
  }

  let expectedParent = current.activeEntryId;
  for (const entry of [...transition.entries].sort(
    (left, right) => left.ordinal - right.ordinal,
  )) {
    if (entry.parentEntryId !== expectedParent) {
      throw new Error(
        "Appended entries must form a chain from the active head.",
      );
    }
    expectedParent = entry.entryId;
  }
  if (result.activeEntryId !== expectedParent) {
    throw new Error("An append must select its last entry.");
  }
}
