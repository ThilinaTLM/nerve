import type {
  CanonicalConversationEntry,
  MutationOutcome,
} from "@nervekit/contracts/conversations";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";

const PAGE_SIZE = 512;
const DEFAULT_MAX_ENTRIES = 8_192;

export interface CanonicalContextSnapshot {
  namespaceId: string;
  executionIncarnationId: string;
  conversationId: string;
  runId: string;
  runGeneration: number;
  runRevision: number;
  sourceEntryId: string;
  sourceRevision: number;
  selectionEpoch: number;
  entries: readonly CanonicalConversationEntry[];
}

export type CanonicalContextResult =
  | { kind: "ready"; snapshot: CanonicalContextSnapshot }
  | { kind: "stale"; outcome: MutationOutcome };

/** Builds disposable provider context exclusively from selected canonical ancestry. */
export class CanonicalConversationContextService {
  constructor(private readonly store: CanonicalStore) {}

  async build(input: {
    conversationId: string;
    runId: string;
    maxEntries?: number;
  }): Promise<CanonicalContextResult> {
    const maxEntries = input.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if (
      !Number.isInteger(maxEntries) ||
      maxEntries < 1 ||
      maxEntries > 65_536
    ) {
      throw new RangeError("Canonical context entry limit is invalid.");
    }
    const [identity, admission, head, run] = await Promise.all([
      this.store.readTimelineStateIdentity(),
      this.store.readTimelineRuntimeAdmission(),
      this.store.readTimelineConversationHead(input.conversationId),
      this.store.readTimelineRunControl(input.conversationId, input.runId),
    ]);
    if (
      !identity ||
      admission?.dispatchState !== "admitted" ||
      admission.executionIncarnationId !== identity.executionIncarnationId ||
      !head ||
      !run ||
      !head.activeEntryId ||
      head.foregroundRunId !== run.runId ||
      run.generation < 1 ||
      run.boundSelectionEpoch !== head.selectionEpoch ||
      run.continuationEntryId !== head.activeEntryId ||
      !run.foregroundOwned
    ) {
      return stale("canonical_context_fence_missing");
    }

    const descending: CanonicalConversationEntry[] = [];
    let sourceEntryId: string | undefined = head.activeEntryId;
    while (sourceEntryId) {
      const remaining = maxEntries - descending.length;
      if (remaining <= 0) {
        throw new Error(
          "Canonical context ancestry exceeds its bounded limit.",
        );
      }
      const segment = await this.store.readTimelineAncestrySegment(
        input.conversationId,
        sourceEntryId,
        Math.min(PAGE_SIZE, remaining),
      );
      descending.push(...segment.entries);
      sourceEntryId = segment.nextAncestorEntryId;
    }
    const snapshot: CanonicalContextSnapshot = {
      namespaceId: identity.namespaceId,
      executionIncarnationId: identity.executionIncarnationId,
      conversationId: input.conversationId,
      runId: run.runId,
      runGeneration: run.generation,
      runRevision: run.revision,
      sourceEntryId: head.activeEntryId,
      sourceRevision: head.revision,
      selectionEpoch: head.selectionEpoch,
      entries: descending.reverse(),
    };
    return (await this.revalidate(snapshot))
      ? { kind: "ready", snapshot }
      : stale("canonical_context_changed_during_build");
  }

  async revalidate(snapshot: CanonicalContextSnapshot): Promise<boolean> {
    const [identity, admission, head, run] = await Promise.all([
      this.store.readTimelineStateIdentity(),
      this.store.readTimelineRuntimeAdmission(),
      this.store.readTimelineConversationHead(snapshot.conversationId),
      this.store.readTimelineRunControl(
        snapshot.conversationId,
        snapshot.runId,
      ),
    ]);
    return Boolean(
      identity?.namespaceId === snapshot.namespaceId &&
      identity.executionIncarnationId === snapshot.executionIncarnationId &&
      admission?.dispatchState === "admitted" &&
      admission.executionIncarnationId === snapshot.executionIncarnationId &&
      head?.revision === snapshot.sourceRevision &&
      head.activeEntryId === snapshot.sourceEntryId &&
      head.selectionEpoch === snapshot.selectionEpoch &&
      head.foregroundRunId === snapshot.runId &&
      run?.generation === snapshot.runGeneration &&
      run.revision === snapshot.runRevision &&
      run.boundSelectionEpoch === snapshot.selectionEpoch &&
      run.continuationEntryId === snapshot.sourceEntryId &&
      run.foregroundOwned,
    );
  }
}

function stale(reason: string): CanonicalContextResult {
  return {
    kind: "stale",
    outcome: { kind: "superseded", reason },
  };
}
