import { createHash, randomUUID } from "node:crypto";
import type {
  CanonicalLifecycleWork,
  ProviderPhase,
} from "@nervekit/contracts/runs";
import type {
  ArtifactReference,
  CanonicalContinuationSnapshot,
  CanonicalConversationEntry,
  ContextSourceManifest,
  MutationOutcome,
} from "@nervekit/contracts/conversations";
import { artifactReferenceSchema } from "@nervekit/contracts/conversations";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import { CanonicalContinuationService } from "./canonical-continuation.service.js";
import {
  CanonicalCompactionCoordinator,
  type PreparedCanonicalCompaction,
} from "./canonical-compaction-coordinator.js";
import {
  canonicalConversationJson,
  conversationCommandFingerprint,
} from "./command-fingerprint.js";

const ANCESTRY_PAGE_SIZE = 512;
const MAX_ANCESTRY_PAGES = 2_048;
const MAX_AUTO_CONTINUATIONS_PER_RUN = 3;

export interface CanonicalArtifactFinalizer {
  finalize(input: {
    artifactId: string;
    ownerKind: "conversation";
    ownerId: string;
    relativeLocator: string;
    bytes: Uint8Array;
    mediaType: "application/json";
    semanticRole:
      | "context_source_manifest"
      | "context_transitive_boundary_manifest";
  }): Promise<ArtifactReference>;
}

export interface CanonicalSummaryPreparation {
  summary: string;
  anchorEntryId: string | null;
}

export interface CanonicalAutoCompactionInput<T> {
  namespaceId: string;
  executionIncarnationId: string;
  conversationId: string;
  runId: string;
  policyVersion: number;
  providerAdapterVersion: string;
  providerIdentity: Record<string, unknown>;
  providerCapability: ProviderPhase["capability"];
  recipeVersion: number;
  preparedAt: string;
  continuationWork?: CanonicalLifecycleWork;
  prepareSummary(
    entriesDescending: readonly CanonicalConversationEntry[],
  ): Promise<CanonicalSummaryPreparation>;
  prepareProviderPhase(snapshot: CanonicalContinuationSnapshot): Promise<T>;
  scheduleProviderPreparation?: boolean;
}

export type CanonicalAutoCompactionResult<T> =
  | {
      kind: "ready";
      snapshot: CanonicalContinuationSnapshot;
      preparedPhase: T;
    }
  | { kind: "stale"; outcome: MutationOutcome };

/**
 * Reads and hashes canonical ancestry and invokes model/artifact work before
 * entering the coordinator's short commit transaction.
 */
export class CanonicalAutoCompactionService {
  private readonly coordinator: CanonicalCompactionCoordinator;

  constructor(
    private readonly store: CanonicalStore,
    private readonly artifacts: CanonicalArtifactFinalizer,
  ) {
    this.coordinator = new CanonicalCompactionCoordinator(store);
  }

  async compactThenPrepareProviderPhase<T>(
    input: CanonicalAutoCompactionInput<T>,
  ): Promise<CanonicalAutoCompactionResult<T>> {
    const [sourceHead, run, priorCompactionPhases, admission] =
      await Promise.all([
        this.store.readTimelineConversationHead(input.conversationId),
        this.store.readTimelineRunControl(input.conversationId, input.runId),
        this.store.countCompactionProviderPhases(input.runId),
        this.store.readTimelineRuntimeAdmission(),
      ]);
    const waitGroup = run?.waitGroupId
      ? await this.store.execution.readWaitGroup(run.waitGroupId)
      : undefined;
    if (!admission || admission.dispatchState !== "admitted") {
      return {
        kind: "stale",
        outcome: {
          kind: "superseded",
          reason: "runtime_dispatch_not_admitted",
        },
      };
    }
    if (
      !sourceHead ||
      !run ||
      sourceHead.activeEntryId === null ||
      sourceHead.foregroundRunId !== run.runId ||
      run.continuationEntryId !== sourceHead.activeEntryId ||
      run.boundSelectionEpoch !== sourceHead.selectionEpoch ||
      !run.foregroundOwned ||
      run.providerPhaseId !== null ||
      (input.continuationWork !== undefined &&
        (input.continuationWork.kind !== "prepare_continuation" ||
          input.continuationWork.state !== "leased" ||
          input.continuationWork.runId !== run.runId ||
          input.continuationWork.conversationId !== run.conversationId ||
          Date.parse(input.continuationWork.leaseDeadline ?? "") <=
            Date.parse(input.preparedAt) ||
          waitGroup?.state !== "ready"))
    ) {
      return {
        kind: "stale",
        outcome: { kind: "superseded", reason: "foreground_fence_missing" },
      };
    }

    if (priorCompactionPhases >= MAX_AUTO_CONTINUATIONS_PER_RUN) {
      return {
        kind: "stale",
        outcome: { kind: "superseded", reason: "continuation_limit_reached" },
      };
    }

    const entries = await this.readCompleteAncestry(
      input.conversationId,
      sourceHead.activeEntryId,
    );
    const summary = await input.prepareSummary(entries);
    if (
      summary.anchorEntryId !== null &&
      !entries.some((entry) => entry.entryId === summary.anchorEntryId)
    ) {
      throw new Error("Prepared compaction anchor is not in source ancestry.");
    }
    const sourceManifest = await this.finalizeSourceManifest(
      input.conversationId,
      sourceHead.activeEntryId,
      entries,
    );
    const prepared: PreparedCanonicalCompaction = {
      namespaceId: input.namespaceId,
      executionIncarnationId: input.executionIncarnationId,
      commandId: `command_${randomUUID()}`,
      transitionId: `transition_${randomUUID()}`,
      boundaryId: `boundary_${randomUUID()}`,
      sourceHead,
      run,
      anchorEntryId: summary.anchorEntryId,
      sourceManifest,
      summary: summary.summary,
      summaryEntryId: `entry_${randomUUID()}`,
      policyVersion: input.policyVersion,
      providerAdapterVersion: input.providerAdapterVersion,
      providerIdentity: input.providerIdentity,
      providerCapability: input.providerCapability,
      recipeVersion: input.recipeVersion,
      actor: { kind: "system" },
      cause: { kind: "automatic_compaction" },
      preparedAt: input.preparedAt,
      continuationWork: input.continuationWork,
      waitGroup,
    };
    if (input.scheduleProviderPreparation) {
      const committed = await this.coordinator.commitPrepared(prepared);
      if (committed.kind === "stale") return committed;
      if (!input.continuationWork?.leaseOwner) {
        return {
          kind: "stale",
          outcome: {
            kind: "superseded",
            reason: "compaction_continuation_work_missing",
          },
        };
      }
      const continuation = await new CanonicalContinuationService(
        this.store,
      ).commitWithoutCompaction({
        continuationWork: input.continuationWork,
        workerId: input.continuationWork.leaseOwner,
        compactionDecisionEvidence: {
          decision: "required",
          boundaryId: committed.snapshot.boundaryId,
        },
        compactedSnapshot: committed.snapshot,
        now: input.preparedAt,
      });
      if (continuation.kind === "rejected") {
        return { kind: "stale", outcome: continuation.outcome };
      }
      return {
        kind: "ready",
        snapshot: committed.snapshot,
        preparedPhase: await input.prepareProviderPhase(committed.snapshot),
      };
    }
    return this.coordinator.commitThenPrepareProviderPhase(
      prepared,
      input.prepareProviderPhase,
    );
  }

  private async readCompleteAncestry(
    conversationId: string,
    sourceEntryId: string,
  ): Promise<CanonicalConversationEntry[]> {
    const entries: CanonicalConversationEntry[] = [];
    const seen = new Set<string>();
    let nextEntryId: string | undefined = sourceEntryId;
    for (let page = 0; nextEntryId && page < MAX_ANCESTRY_PAGES; page += 1) {
      const segment = await this.store.readTimelineAncestrySegment(
        conversationId,
        nextEntryId,
        ANCESTRY_PAGE_SIZE,
      );
      for (const entry of segment.entries) {
        if (seen.has(entry.entryId)) {
          throw new Error("Canonical ancestry contains a cycle or overlap.");
        }
        seen.add(entry.entryId);
        entries.push(entry);
      }
      nextEntryId = segment.nextAncestorEntryId;
    }
    if (nextEntryId) {
      throw new RangeError(
        "Canonical ancestry exceeds compaction proof limit.",
      );
    }
    return entries;
  }

  private async finalizeSourceManifest(
    conversationId: string,
    sourceTipEntryId: string,
    entries: readonly CanonicalConversationEntry[],
  ): Promise<ContextSourceManifest> {
    const entryPayload = {
      schemaVersion: 1,
      conversationId,
      sourceTipEntryId,
      entries: entries.map((entry) => ({
        entryId: entry.entryId,
        transitionId: entry.transitionId,
        parentEntryId: entry.parentEntryId,
      })),
    };
    const entriesManifest = await this.finalizeArtifact(
      conversationId,
      "context_source_manifest",
      entryPayload,
    );
    const boundaryIds = [
      ...new Set(
        entries
          .map((entry) => entry.provenance.boundaryId)
          .filter(
            (boundaryId): boundaryId is string =>
              typeof boundaryId === "string" &&
              boundaryId.startsWith("boundary_"),
          ),
      ),
    ].sort();
    const transitiveBoundariesManifest =
      boundaryIds.length === 0
        ? undefined
        : await this.finalizeArtifact(
            conversationId,
            "context_transitive_boundary_manifest",
            { schemaVersion: 1, conversationId, boundaryIds },
          );
    return {
      schemaVersion: 1,
      conversationId,
      sourceTipEntryId,
      entryCount: entries.length,
      entriesManifest,
      transitiveBoundaryCount: boundaryIds.length,
      ...(transitiveBoundariesManifest ? { transitiveBoundariesManifest } : {}),
      digest: conversationCommandFingerprint({
        entriesDigest: entriesManifest.digest,
        transitiveBoundariesDigest: transitiveBoundariesManifest?.digest,
      }),
    };
  }

  private async finalizeArtifact(
    conversationId: string,
    semanticRole:
      | "context_source_manifest"
      | "context_transitive_boundary_manifest",
    payload: unknown,
  ): Promise<ArtifactReference> {
    const bytes = Buffer.from(canonicalConversationJson(payload));
    const artifactId = `artifact_${randomUUID()}`;
    const expectedDigest = `sha256:${createHash("sha256")
      .update(bytes)
      .digest("hex")}`;
    const artifact = artifactReferenceSchema.parse(
      await this.artifacts.finalize({
        artifactId,
        ownerKind: "conversation",
        ownerId: conversationId,
        relativeLocator: `context/${artifactId}.json`,
        bytes,
        mediaType: "application/json",
        semanticRole,
      }),
    );
    if (
      artifact.artifactId !== artifactId ||
      artifact.ownerKind !== "conversation" ||
      artifact.ownerId !== conversationId ||
      artifact.digest !== expectedDigest ||
      artifact.byteLength !== bytes.byteLength ||
      artifact.semanticRole !== semanticRole ||
      artifact.availability !== "available"
    ) {
      throw new Error(
        "Artifact finalizer returned mismatched source evidence.",
      );
    }
    return artifact;
  }
}
