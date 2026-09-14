import { createHash } from "node:crypto";
import type { MutationOutcome } from "@nervekit/contracts/conversations";
import type {
  CanonicalLifecycleWork,
  ProviderPhase,
  WaitGroup,
} from "@nervekit/contracts/runs";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import { canonicalConversationJson } from "./command-fingerprint.js";
import { CanonicalRunTimelineService } from "./canonical-run-timeline.service.js";

interface ContinuationManifest {
  schemaVersion: 1;
  conversationId: string;
  runId: string;
  runGeneration: number;
  selectionEpoch: number;
  sourceEntryId: string;
  waitGroupId: string;
  providerIdentity: Record<string, unknown>;
  providerCapability: ProviderPhase["capability"];
}

export type CanonicalContinuationResult =
  | {
      kind: "committed" | "receipt_replay";
      phase: ProviderPhase;
      work: CanonicalLifecycleWork;
    }
  | { kind: "rejected"; outcome: MutationOutcome };

/** Admits the next provider phase only after the settled-iteration gate. */
export class CanonicalContinuationService {
  private readonly timeline: CanonicalRunTimelineService;

  constructor(private readonly store: CanonicalStore) {
    this.timeline = new CanonicalRunTimelineService(store);
  }

  async commitWithoutCompaction(input: {
    continuationWork: CanonicalLifecycleWork;
    workerId: string;
    compactionDecisionEvidence: Record<string, unknown>;
    now: string;
  }): Promise<CanonicalContinuationResult> {
    const work = input.continuationWork;
    if (
      work.kind !== "prepare_continuation" ||
      work.state !== "leased" ||
      work.leaseOwner !== input.workerId ||
      Date.parse(work.leaseDeadline ?? "") <= Date.parse(input.now) ||
      !work.inputManifestId
    ) {
      return rejected("continuation_work_not_owned");
    }
    const manifestValue = await this.store.execution.readArtifactManifest(
      work.inputManifestId,
    );
    const manifest = parseManifest(manifestValue);
    if (
      `sha256:${createHash("sha256")
        .update(canonicalConversationJson(manifest))
        .digest("hex")}` !== work.inputHash
    ) {
      return rejected("continuation_manifest_hash_mismatch");
    }
    const [identity, admission, head, run, group] = await Promise.all([
      this.store.readTimelineStateIdentity(),
      this.store.readTimelineRuntimeAdmission(),
      this.store.readTimelineConversationHead(work.conversationId),
      this.store.readTimelineRunControl(work.conversationId, work.runId),
      this.store.execution.readWaitGroup(manifest.waitGroupId),
    ]);
    if (
      !identity ||
      !head ||
      !run ||
      !group ||
      admission?.dispatchState !== "admitted" ||
      admission.executionIncarnationId !== identity.executionIncarnationId ||
      manifest.conversationId !== work.conversationId ||
      manifest.runId !== work.runId ||
      manifest.runGeneration !== run.generation ||
      manifest.selectionEpoch !== head.selectionEpoch ||
      manifest.sourceEntryId !== head.activeEntryId ||
      group.state !== "ready" ||
      group.continuationConsumed ||
      run.waitGroupId !== group.waitGroupId ||
      run.providerPhaseId !== null ||
      run.state !== "waiting" ||
      run.boundSelectionEpoch !== head.selectionEpoch ||
      run.continuationEntryId !== head.activeEntryId ||
      head.foregroundRunId !== run.runId ||
      !run.foregroundOwned
    ) {
      return rejected("continuation_fence_changed");
    }
    const suffix = work.workId.slice("canonical_work_".length);
    const phaseId = `provider_phase_${suffix}`;
    const decisionManifestId = `manifest_continuation_decision_${suffix}`;
    const decisionData = {
      schemaVersion: 1,
      sourceContinuationManifestId: work.inputManifestId,
      sourceContinuationHash: work.inputHash,
      compaction: {
        required: false,
        evidence: input.compactionDecisionEvidence,
      },
    };
    const preparationHash = `sha256:${createHash("sha256")
      .update(canonicalConversationJson(decisionData))
      .digest("hex")}`;
    const phase: ProviderPhase = {
      schemaVersion: 1,
      phaseId,
      runId: run.runId,
      runGeneration: run.generation,
      selectionEpoch: head.selectionEpoch,
      sourceEntryId: head.activeEntryId!,
      contextRecipeId: `context_recipe_${suffix}`,
      providerIdentity: manifest.providerIdentity,
      capability: manifest.providerCapability,
      state: "preparing",
    };
    const preparationWork: CanonicalLifecycleWork = {
      schemaVersion: 1,
      workId: `canonical_work_${suffix}_prepare`,
      conversationId: work.conversationId,
      runId: work.runId,
      kind: "prepare_provider_request",
      providerPhaseId: phaseId,
      state: "ready",
      inputHash: preparationHash,
      inputManifestId: decisionManifestId,
      generation: 0,
      revision: 1,
      notBefore: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    };
    const settledWork: CanonicalLifecycleWork = {
      ...work,
      state: "settled",
      revision: work.revision + 1,
      leaseOwner: undefined,
      leaseDeadline: undefined,
      updatedAt: input.now,
    };
    const closedGroup: WaitGroup = {
      ...group,
      continuationConsumed: true,
      state: "closed",
      revision: group.revision + 1,
    };
    const result = await this.timeline.append({
      conversationId: work.conversationId,
      runId: work.runId,
      commandId: `commit-continuation:${work.workId}:${work.generation}`,
      now: input.now,
      actor: { kind: "worker", workerId: input.workerId },
      cause: { kind: "settled_iteration_continuation", compacted: false },
      entries: [],
      artifactManifests: [
        {
          manifestId: decisionManifestId,
          schemaVersion: 1,
          data: decisionData,
        },
      ],
      waitGroups: [closedGroup],
      providerPhases: [phase],
      lifecycleWorks: [settledWork, preparationWork],
      providerPhaseId: phaseId,
      waitGroupId: null,
      runState: "running",
    });
    return result.kind === "rejected"
      ? result
      : { kind: result.kind, phase, work: preparationWork };
  }
}

function parseManifest(value: unknown): ContinuationManifest {
  const input = value as Partial<ContinuationManifest> | undefined;
  if (
    input?.schemaVersion !== 1 ||
    typeof input.conversationId !== "string" ||
    typeof input.runId !== "string" ||
    !Number.isSafeInteger(input.runGeneration) ||
    !Number.isSafeInteger(input.selectionEpoch) ||
    typeof input.sourceEntryId !== "string" ||
    typeof input.waitGroupId !== "string" ||
    typeof input.providerIdentity !== "object" ||
    !input.providerIdentity ||
    typeof input.providerCapability !== "string"
  ) {
    throw new Error("Canonical continuation manifest is malformed.");
  }
  return input as ContinuationManifest;
}

function rejected(reason: string): CanonicalContinuationResult {
  return { kind: "rejected", outcome: { kind: "superseded", reason } };
}
