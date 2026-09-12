import { randomUUID } from "node:crypto";
import type {
  ContextBoundary,
  ContextSourceManifest,
  ConversationHead,
  MutationOutcome,
} from "@nervekit/contracts/conversations";
import type { RunControl } from "@nervekit/contracts/runs";
import { z } from "zod";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import { conversationCommandFingerprint } from "./command-fingerprint.js";
import { ConversationTransitionService } from "./conversation-transition.service.js";
import {
  buildAppendTransition,
  buildControlTransition,
} from "./transition-builders.js";

export interface PreparedCanonicalCompaction {
  namespaceId: string;
  executionIncarnationId: string;
  commandId: string;
  transitionId?: string;
  boundaryId?: string;
  sourceHead: ConversationHead;
  run: RunControl;
  anchorEntryId: string | null;
  sourceManifest: ContextSourceManifest;
  summary?: string;
  summaryEntryId?: string;
  policyVersion: number;
  providerAdapterVersion: string;
  recipeVersion: number;
  actor: Record<string, unknown>;
  cause: Record<string, unknown>;
  preparedAt: string;
}

const canonicalContinuationSnapshotSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  headEntryId: z.string().startsWith("entry_").nullable(),
  revision: z.number().int().nonnegative().safe(),
  selectionEpoch: z.number().int().nonnegative().safe(),
  runId: z.string().startsWith("run_"),
  runGeneration: z.number().int().positive().safe(),
  runRevision: z.number().int().positive().safe(),
  boundaryId: z.string().startsWith("boundary_"),
});
export type CanonicalContinuationSnapshot = z.infer<
  typeof canonicalContinuationSnapshotSchema
>;

export type CanonicalCompactionCommitResult =
  | {
      kind: "committed" | "receipt_replay";
      snapshot: CanonicalContinuationSnapshot;
    }
  | { kind: "stale"; outcome: MutationOutcome };

/**
 * Commits only externally prepared summaries. The next provider phase must not
 * be prepared or dispatched until this returns a revalidated snapshot.
 */
export class CanonicalCompactionCoordinator {
  private readonly transitions: ConversationTransitionService;

  constructor(private readonly store: CanonicalStore) {
    this.transitions = new ConversationTransitionService(store);
  }

  async commitPrepared(
    prepared: PreparedCanonicalCompaction,
  ): Promise<CanonicalCompactionCommitResult> {
    assertPreparedCompaction(prepared);
    const transitionId = prepared.transitionId ?? `transition_${randomUUID()}`;
    const boundaryId = prepared.boundaryId ?? `boundary_${randomUUID()}`;
    const fingerprint = conversationCommandFingerprint({
      operation: "automatic_context_compaction",
      conversationId: prepared.sourceHead.conversationId,
      sourceRevision: prepared.sourceHead.revision,
      sourceEntryId: prepared.sourceHead.activeEntryId,
      selectionEpoch: prepared.sourceHead.selectionEpoch,
      runId: prepared.run.runId,
      runGeneration: prepared.run.generation,
      anchorEntryId: prepared.anchorEntryId,
      sourceManifestDigest: prepared.sourceManifest.digest,
      summary: prepared.summary,
      policyVersion: prepared.policyVersion,
      providerAdapterVersion: prepared.providerAdapterVersion,
      recipeVersion: prepared.recipeVersion,
    });
    const identity = {
      commandId: prepared.commandId,
      inputFingerprint: fingerprint,
      actor: prepared.actor,
      cause: prepared.cause,
      committedAt: prepared.preparedAt,
      transitionId,
    };
    const transition = prepared.summary
      ? buildAppendTransition({
          head: prepared.sourceHead,
          identity,
          kind: "context_boundary_committed",
          entries: [
            {
              entryId: prepared.summaryEntryId,
              kind: "summary",
              inlineContent: { text: prepared.summary },
              runId: prepared.run.runId,
              provenance: {
                boundaryId,
                sourceManifestDigest: prepared.sourceManifest.digest,
              },
            },
          ],
        })
      : buildControlTransition({
          head: prepared.sourceHead,
          identity,
          kind: "context_boundary_committed",
        });
    const boundary: ContextBoundary = {
      schemaVersion: 1,
      boundaryId,
      conversationId: prepared.sourceHead.conversationId,
      transitionId,
      anchorEntryId: prepared.anchorEntryId,
      sourceTipEntryId: prepared.sourceHead.activeEntryId,
      sourceManifest: prepared.sourceManifest,
      policyVersion: prepared.policyVersion,
      providerAdapterVersion: prepared.providerAdapterVersion,
      recipeVersion: prepared.recipeVersion,
      ...(prepared.summary
        ? { visibleSummaryEntryId: transition.entries[0]!.entryId }
        : {}),
    };
    const nextRun: RunControl = {
      ...prepared.run,
      continuationEntryId: transition.resultingHead.activeEntryId,
      revision: prepared.run.revision + 1,
    };
    const intendedSnapshot: CanonicalContinuationSnapshot = {
      conversationId: prepared.sourceHead.conversationId,
      headEntryId: transition.resultingHead.activeEntryId,
      revision: transition.resultingHead.revision,
      selectionEpoch: transition.resultingHead.selectionEpoch,
      runId: nextRun.runId,
      runGeneration: nextRun.generation,
      runRevision: nextRun.revision,
      boundaryId,
    };
    const outcome = await this.transitions.commit({
      namespaceId: prepared.namespaceId,
      executionIncarnationId: prepared.executionIncarnationId,
      operationKind: "automatic_context_compaction",
      ownerKind: "conversation",
      ownerId: prepared.sourceHead.conversationId,
      commandId: prepared.commandId,
      fingerprintVersion: 1,
      fingerprint,
      expectedHeads: [
        {
          conversationId: prepared.sourceHead.conversationId,
          revision: prepared.sourceHead.revision,
          selectionEpoch: prepared.sourceHead.selectionEpoch,
        },
      ],
      expectedRunFences: [
        {
          conversationId: prepared.run.conversationId,
          runId: prepared.run.runId,
          generation: prepared.run.generation,
          revision: prepared.run.revision,
          selectionEpoch: prepared.run.boundSelectionEpoch,
          continuationEntryId: prepared.run.continuationEntryId,
          requireForegroundOwnership: true,
        },
      ],
      transitions: [transition],
      contextBoundaries: [boundary],
      runControls: [nextRun],
      outcome: intendedSnapshot,
      publicationIntents: [],
      now: prepared.preparedAt,
    });
    if (outcome.kind !== "committed" && outcome.kind !== "receipt_replay") {
      return { kind: "stale", outcome };
    }
    const snapshot =
      outcome.kind === "receipt_replay"
        ? canonicalContinuationSnapshotSchema.parse(outcome.value)
        : intendedSnapshot;
    return (await this.revalidateBeforeProviderDispatch(snapshot))
      ? { kind: outcome.kind, snapshot }
      : {
          kind: "stale",
          outcome: {
            kind: "superseded",
            reason: "post_commit_fence_changed",
          },
        };
  }

  async commitThenPrepareProviderPhase<T>(
    prepared: PreparedCanonicalCompaction,
    prepareProviderPhase: (
      snapshot: CanonicalContinuationSnapshot,
    ) => Promise<T>,
  ): Promise<
    | {
        kind: "ready";
        snapshot: CanonicalContinuationSnapshot;
        preparedPhase: T;
      }
    | { kind: "stale"; outcome: MutationOutcome }
  > {
    const committed = await this.commitPrepared(prepared);
    if (committed.kind === "stale") return committed;
    const preparedPhase = await prepareProviderPhase(committed.snapshot);
    if (!(await this.revalidateBeforeProviderDispatch(committed.snapshot))) {
      return {
        kind: "stale",
        outcome: {
          kind: "superseded",
          reason: "provider_preparation_fence_changed",
        },
      };
    }
    return {
      kind: "ready",
      snapshot: committed.snapshot,
      preparedPhase,
    };
  }

  async revalidateBeforeProviderDispatch(
    snapshot: CanonicalContinuationSnapshot,
  ): Promise<boolean> {
    const [head, run] = await Promise.all([
      this.store.readTimelineConversationHead(snapshot.conversationId),
      this.store.readTimelineRunControl(
        snapshot.conversationId,
        snapshot.runId,
      ),
    ]);
    return Boolean(
      head &&
      run &&
      head.revision === snapshot.revision &&
      head.activeEntryId === snapshot.headEntryId &&
      head.selectionEpoch === snapshot.selectionEpoch &&
      head.foregroundRunId === snapshot.runId &&
      run.generation === snapshot.runGeneration &&
      run.revision === snapshot.runRevision &&
      run.boundSelectionEpoch === snapshot.selectionEpoch &&
      run.continuationEntryId === snapshot.headEntryId &&
      run.foregroundOwned,
    );
  }
}

function assertPreparedCompaction(prepared: PreparedCanonicalCompaction): void {
  if (
    prepared.sourceHead.conversationId !== prepared.run.conversationId ||
    prepared.sourceHead.foregroundRunId !== prepared.run.runId ||
    prepared.sourceHead.selectionEpoch !== prepared.run.boundSelectionEpoch ||
    prepared.sourceHead.activeEntryId !== prepared.run.continuationEntryId ||
    !prepared.run.foregroundOwned
  ) {
    throw new Error(
      "Prepared compaction is not bound to the foreground continuation.",
    );
  }
  if (
    prepared.sourceManifest.conversationId !==
      prepared.sourceHead.conversationId ||
    prepared.sourceManifest.sourceTipEntryId !==
      prepared.sourceHead.activeEntryId
  ) {
    throw new Error(
      "Prepared compaction source manifest does not match its head.",
    );
  }
}
