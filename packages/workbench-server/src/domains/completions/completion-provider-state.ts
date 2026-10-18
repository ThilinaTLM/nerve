import type { CompletionScope } from "@nervekit/contracts/completions";
import type {
  CompletionDocument,
  CompletionInvalidation,
  ProviderState,
} from "./completion-provider.js";

/** Returns false for uncertainty: preserve active work and eligibility. */
export function invalidateCompletionProvider(
  state: ProviderState,
  hint?: CompletionInvalidation,
): boolean {
  state.expiresAt = 0;
  if (hint?.refreshCause === "uncertain_poll") {
    state.uncertainty = (state.uncertainty ?? 0) + 1;
    state.status = "stale";
    return false;
  }
  state.hardGeneration = ++state.generation;
  return true;
}

/** A useful stale load satisfies its waiters even if one coalesced uncertain
 * follow-up starts. A hard supersession must instead wait for its replacement. */
export async function settledCompletionProvider(
  state: ProviderState,
): Promise<void> {
  const wanted = state.generation;
  while (state.pending) {
    await state.pending;
    if (
      (state.completedGeneration ?? 0) >=
      Math.max(wanted, state.hardGeneration ?? 0)
    )
      return;
  }
}

export function completionDocumentUnits(document: CompletionDocument): number {
  const retained = document.retainedUnits;
  if (retained !== undefined) {
    if (
      !Number.isSafeInteger(retained) ||
      retained < document.id.length + document.kind.length
    )
      throw new Error("Invalid retained completion size");
    return retained;
  }
  return (
    document.id.length +
    document.kind.length +
    document.version.length +
    document.fields.reduce((sum, field) => sum + field.text.length, 0) +
    JSON.stringify(document.item).length
  );
}

export const completionScopeMatches = (
  scope: CompletionScope,
  change?: Partial<CompletionScope>,
) =>
  !change ||
  ((!change.projectId || scope.projectId === change.projectId) &&
    (!change.conversationId || scope.conversationId === change.conversationId));

export function completionDocumentScopeMatches(
  scope: CompletionScope,
  document: CompletionDocument,
): boolean {
  return (
    document.projectId === scope.projectId &&
    (!document.conversationId ||
      document.conversationId === scope.conversationId)
  );
}
