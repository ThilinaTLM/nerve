import { randomUUID } from "node:crypto";
import {
  canonicalContinuationSnapshotSchema,
  type CanonicalContinuationSnapshot,
  type ContextBoundary,
  type ContextSourceManifest,
  type ConversationHead,
  type MutationOutcome,
} from "@nervekit/contracts/conversations";
import type {
  CanonicalLifecycleWork,
  ProviderPhase,
  RunControl,
  WaitGroup,
} from "@nervekit/contracts/runs";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import {
  canonicalConversationJson,
  conversationCommandFingerprint,
} from "./command-fingerprint.js";
import { createHash } from "node:crypto";
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
  summaryMetadata?: Record<string, unknown>;
  policyVersion: number;
  providerAdapterVersion: string;
  providerIdentity: Record<string, unknown>;
  providerCapability: ProviderPhase["capability"];
  recipeVersion: number;
  actor: Record<string, unknown>;
  cause: Record<string, unknown>;
  preparedAt: string;
  continuationWork?: CanonicalLifecycleWork;
  waitGroup?: WaitGroup;
}

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
      summaryMetadata: prepared.summaryMetadata,
      policyVersion: prepared.policyVersion,
      providerAdapterVersion: prepared.providerAdapterVersion,
      providerIdentity: prepared.providerIdentity,
      providerCapability: prepared.providerCapability,
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
              inlineContent: {
                text: prepared.summary,
                ...(prepared.summaryMetadata
                  ? { details: prepared.summaryMetadata }
                  : {}),
              },
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
      schemaVersion: 1,
      namespaceId: prepared.namespaceId,
      executionIncarnationId: prepared.executionIncarnationId,
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
      requireRuntimeDispatchAdmission: true,
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
      finalizedArtifacts: [
        boundary.sourceManifest.entriesManifest,
        ...(boundary.sourceManifest.transitiveBoundariesManifest
          ? [boundary.sourceManifest.transitiveBoundariesManifest]
          : []),
      ],
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
    if (!(await this.revalidateBeforeProviderDispatch(committed.snapshot))) {
      return {
        kind: "stale",
        outcome: {
          kind: "superseded",
          reason: "provider_preparation_fence_changed",
        },
      };
    }
    const preparedPhase = await prepareProviderPhase(committed.snapshot);
    const phaseCommit = await this.commitPreparedProviderPhase(
      prepared,
      committed.snapshot,
      preparedPhase,
    );
    if (phaseCommit.kind === "stale") return phaseCommit;
    return {
      kind: "ready",
      snapshot: phaseCommit.snapshot,
      preparedPhase,
    };
  }

  private async commitPreparedProviderPhase<T>(
    prepared: PreparedCanonicalCompaction,
    snapshot: CanonicalContinuationSnapshot,
    preparedPhase: T,
  ): Promise<CanonicalCompactionCommitResult> {
    const [run, currentContinuationWork] = await Promise.all([
      this.store.readTimelineRunControl(
        snapshot.conversationId,
        snapshot.runId,
      ),
      prepared.continuationWork
        ? this.store.execution.readLifecycleWork(
            prepared.continuationWork.workId,
          )
        : undefined,
    ]);
    if (!run || !(await this.revalidateBeforeProviderDispatch(snapshot))) {
      return {
        kind: "stale",
        outcome: {
          kind: "superseded",
          reason: "provider_preparation_fence_changed",
        },
      };
    }
    const identitySuffix = snapshot.boundaryId.slice("boundary_".length);
    const phaseId = `provider_phase_compaction_${identitySuffix}`;
    const requestManifestId = `manifest_provider_request_${identitySuffix}`;
    const requestData = { schemaVersion: 1, snapshot, preparedPhase };
    const requestHash = `sha256:${createHash("sha256")
      .update(canonicalConversationJson(requestData))
      .digest("hex")}`;
    const phase: ProviderPhase = {
      schemaVersion: 1,
      phaseId,
      runId: snapshot.runId,
      runGeneration: snapshot.runGeneration,
      selectionEpoch: snapshot.selectionEpoch,
      sourceEntryId: snapshot.headEntryId,
      contextRecipeId: `context_recipe_${identitySuffix}`,
      requestManifestId,
      requestHash,
      providerIdentity: prepared.providerIdentity,
      capability: prepared.providerCapability,
      state: "ready",
    };
    const continuationWork = prepared.continuationWork;
    const waitGroup = prepared.waitGroup;
    if (
      continuationWork &&
      (continuationWork.state !== "leased" ||
        currentContinuationWork?.state !== "leased" ||
        currentContinuationWork.generation !== continuationWork.generation ||
        currentContinuationWork.leaseOwner !== continuationWork.leaseOwner ||
        Date.parse(currentContinuationWork.leaseDeadline ?? "") <=
          Date.parse(prepared.preparedAt) ||
        Date.parse(continuationWork.leaseDeadline ?? "") <=
          Date.parse(prepared.preparedAt) ||
        waitGroup?.state !== "ready" ||
        waitGroup.continuationConsumed)
    ) {
      return {
        kind: "stale",
        outcome: {
          kind: "superseded",
          reason: "compaction_continuation_authority_changed",
        },
      };
    }
    const nextRun: RunControl = {
      ...run,
      providerPhaseId: phaseId,
      ...(continuationWork
        ? { waitGroupId: null, state: "running" as const }
        : {}),
      revision: run.revision + 1,
    };
    const dispatchSnapshot: CanonicalContinuationSnapshot = {
      ...snapshot,
      runRevision: nextRun.revision,
    };
    const fingerprint = conversationCommandFingerprint({
      operation: "prepare_provider_phase",
      snapshot,
      phase,
      requestHash,
    });
    const outcome = await this.transitions.commit({
      namespaceId: prepared.namespaceId,
      executionIncarnationId: prepared.executionIncarnationId,
      operationKind: "prepare_provider_phase",
      ownerKind: "conversation",
      ownerId: snapshot.conversationId,
      commandId: `prepare-provider-phase:${snapshot.boundaryId}`,
      fingerprintVersion: 1,
      fingerprint,
      requireRuntimeDispatchAdmission: true,
      expectedHeads: [
        {
          conversationId: snapshot.conversationId,
          revision: snapshot.revision,
          selectionEpoch: snapshot.selectionEpoch,
        },
      ],
      expectedRunFences: [
        {
          conversationId: snapshot.conversationId,
          runId: snapshot.runId,
          generation: snapshot.runGeneration,
          revision: snapshot.runRevision,
          selectionEpoch: snapshot.selectionEpoch,
          continuationEntryId: snapshot.headEntryId,
          requireForegroundOwnership: true,
        },
      ],
      transitions: [],
      artifactManifests: [
        { manifestId: requestManifestId, schemaVersion: 1, data: requestData },
      ],
      providerPhases: [phase],
      runControls: [nextRun],
      waitGroups: waitGroup
        ? [
            {
              ...waitGroup,
              continuationConsumed: true,
              state: "closed",
              revision: waitGroup.revision + 1,
            },
          ]
        : [],
      lifecycleWorks: [
        ...(continuationWork
          ? [
              {
                ...continuationWork,
                state: "settled" as const,
                revision: continuationWork.revision + 1,
                leaseOwner: undefined,
                leaseDeadline: undefined,
                updatedAt: prepared.preparedAt,
              },
            ]
          : []),
        {
          schemaVersion: 1,
          workId: `canonical_work_compaction_${identitySuffix}_claim`,
          conversationId: snapshot.conversationId,
          runId: snapshot.runId,
          kind: "claim_provider_attempt",
          providerPhaseId: phaseId,
          state: "ready",
          inputHash: requestHash,
          generation: 0,
          revision: 1,
          notBefore: prepared.preparedAt,
          createdAt: prepared.preparedAt,
          updatedAt: prepared.preparedAt,
        },
      ],
      outcome: dispatchSnapshot,
      publicationIntents: [],
      now: prepared.preparedAt,
    });
    if (outcome.kind !== "committed" && outcome.kind !== "receipt_replay") {
      return { kind: "stale", outcome };
    }
    const persistedSnapshot =
      outcome.kind === "receipt_replay"
        ? canonicalContinuationSnapshotSchema.parse(outcome.value)
        : dispatchSnapshot;
    return (await this.revalidateBeforeProviderDispatch(persistedSnapshot))
      ? { kind: outcome.kind, snapshot: persistedSnapshot }
      : {
          kind: "stale",
          outcome: {
            kind: "superseded",
            reason: "provider_phase_commit_fence_changed",
          },
        };
  }

  async revalidateBeforeProviderDispatch(
    snapshot: CanonicalContinuationSnapshot,
  ): Promise<boolean> {
    const [head, run, identity, admission] = await Promise.all([
      this.store.readTimelineConversationHead(snapshot.conversationId),
      this.store.readTimelineRunControl(
        snapshot.conversationId,
        snapshot.runId,
      ),
      this.store.readTimelineStateIdentity(),
      this.store.readTimelineRuntimeAdmission(),
    ]);
    return Boolean(
      head &&
      run &&
      identity?.namespaceId === snapshot.namespaceId &&
      identity.executionIncarnationId === snapshot.executionIncarnationId &&
      admission?.dispatchState === "admitted" &&
      admission.executionIncarnationId === snapshot.executionIncarnationId &&
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
