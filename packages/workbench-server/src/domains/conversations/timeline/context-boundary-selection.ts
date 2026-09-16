import type { ContextBoundary } from "@nervekit/contracts/conversations";

export interface ContextBoundaryCandidate {
  boundary: ContextBoundary;
  commitRevision: number;
  withinTransitionOrdinal: number;
}

export interface ContextBoundarySelectionInput {
  conversationId: string;
  selectedHeadEntryId: string | null;
  viewRevision: number;
  contextPolicyVersion: number;
  visibilityId: string;
  candidates: readonly ContextBoundaryCandidate[];
}

export interface ContextBoundaryProofPort {
  isAncestor(
    conversationId: string,
    ancestorEntryId: string | null,
    descendantEntryId: string | null,
  ): Promise<boolean>;
  entryDepth(conversationId: string, entryId: string | null): Promise<number>;
  manifestInputsAreEligible(input: {
    boundary: ContextBoundary;
    selectedHeadEntryId: string | null;
    visibilityId: string;
  }): Promise<boolean>;
}

/** INV-CONTEXT-01: deterministically selects one branch-safe boundary. */
export async function selectContextBoundary(
  input: ContextBoundarySelectionInput,
  proof: ContextBoundaryProofPort,
): Promise<ContextBoundaryCandidate | undefined> {
  const eligible: Array<ContextBoundaryCandidate & { depth: number }> = [];
  for (const candidate of input.candidates) {
    const { boundary } = candidate;
    if (
      boundary.conversationId !== input.conversationId ||
      boundary.policyVersion !== input.contextPolicyVersion ||
      candidate.commitRevision > input.viewRevision
    ) {
      continue;
    }
    if (
      !(await proof.isAncestor(
        input.conversationId,
        boundary.anchorEntryId,
        input.selectedHeadEntryId,
      )) ||
      !(await proof.isAncestor(
        input.conversationId,
        boundary.sourceTipEntryId,
        input.selectedHeadEntryId,
      ))
    ) {
      continue;
    }
    if (
      !(await proof.manifestInputsAreEligible({
        boundary,
        selectedHeadEntryId: input.selectedHeadEntryId,
        visibilityId: input.visibilityId,
      }))
    ) {
      continue;
    }
    eligible.push({
      ...candidate,
      depth: await proof.entryDepth(
        input.conversationId,
        boundary.anchorEntryId,
      ),
    });
  }
  eligible.sort(
    (left, right) =>
      right.depth - left.depth ||
      right.commitRevision - left.commitRevision ||
      right.withinTransitionOrdinal - left.withinTransitionOrdinal ||
      left.boundary.boundaryId.localeCompare(right.boundary.boundaryId),
  );
  const selected = eligible[0];
  if (!selected) return undefined;
  return {
    boundary: selected.boundary,
    commitRevision: selected.commitRevision,
    withinTransitionOrdinal: selected.withinTransitionOrdinal,
  };
}
