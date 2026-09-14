import { createHash } from "node:crypto";
import {
  canonicalLifecycleWorkSchema,
  providerPhaseSchema,
  runControlSchema,
  type CanonicalLifecycleWork,
  type ProviderPhase,
  type RunControl,
} from "@nervekit/contracts/runs";
import type { MutationOutcome } from "@nervekit/contracts/conversations";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import {
  canonicalConversationJson,
  conversationCommandFingerprint,
} from "./command-fingerprint.js";
import { CanonicalTimelineIdentityService } from "./canonical-timeline-identity.service.js";
import { ConversationTransitionService } from "./conversation-transition.service.js";

export type CanonicalProviderPreparationResult =
  | {
      kind: "committed" | "receipt_replay";
      phase: ProviderPhase;
      work: CanonicalLifecycleWork;
      run: RunControl;
    }
  | { kind: "rejected"; outcome: MutationOutcome };

/** Commits one frozen provider request and leaves discoverable claim work. */
export class CanonicalProviderPreparationService {
  private readonly identity: CanonicalTimelineIdentityService;
  private readonly transitions: ConversationTransitionService;

  constructor(private readonly store: CanonicalStore) {
    this.identity = new CanonicalTimelineIdentityService(store);
    this.transitions = new ConversationTransitionService(store);
  }

  async commitPreparedRequest(input: {
    workId: string;
    workerId: string;
    conversationId: string;
    runId: string;
    phaseId: string;
    request: unknown;
    now: string;
  }): Promise<CanonicalProviderPreparationResult> {
    const [identity, admission, head, run, phase, work] = await Promise.all([
      this.identity.resolve(),
      this.store.readTimelineRuntimeAdmission(),
      this.store.readTimelineConversationHead(input.conversationId),
      this.store.readTimelineRunControl(input.conversationId, input.runId),
      this.store.execution.readProviderPhase(input.phaseId),
      this.store.execution.readLifecycleWork(input.workId),
    ]);
    if (!phase) return rejected("provider_phase_missing");
    const suffix = phase.phaseId.slice("provider_phase_".length);
    const requestManifestId = `manifest_provider_request_${suffix}`;
    const requestData = {
      schemaVersion: 1,
      phaseId: phase.phaseId,
      contextRecipeId: phase.contextRecipeId,
      sourceEntryId: phase.sourceEntryId,
      request: input.request,
    };
    const requestHash = `sha256:${createHash("sha256")
      .update(canonicalConversationJson(requestData))
      .digest("hex")}`;
    const readyPhase: ProviderPhase = {
      ...phase,
      requestManifestId,
      requestHash,
      state: "ready",
    };
    const commandId = `prepare-provider-request:${phase.phaseId}`;
    const fingerprint = conversationCommandFingerprint({
      operation: "prepare_provider_request",
      phase: readyPhase,
      requestData,
      workId: input.workId,
      workerId: input.workerId,
    });
    const receipt = await this.store.readTimelineCommandReceipt({
      namespaceId: identity.namespaceId,
      operationKind: "prepare_provider_request",
      ownerKind: "conversation",
      ownerId: input.conversationId,
      commandId,
      fingerprint,
    });
    if (receipt?.kind === "receipt_replay") {
      const value = receipt.value as Record<string, unknown>;
      return {
        kind: "receipt_replay",
        phase: providerPhaseSchema.parse(value.phase),
        work: canonicalLifecycleWorkSchema.parse(value.work),
        run: runControlSchema.parse(value.run),
      };
    }
    if (
      admission?.dispatchState !== "admitted" ||
      admission.executionIncarnationId !== identity.executionIncarnationId ||
      !head ||
      !run ||
      !work ||
      work.kind !== "prepare_provider_request" ||
      work.providerPhaseId !== phase.phaseId ||
      work.state !== "leased" ||
      work.leaseOwner !== input.workerId ||
      Date.parse(work.leaseDeadline ?? "") <= Date.parse(input.now) ||
      phase.state !== "preparing" ||
      run.providerPhaseId !== phase.phaseId ||
      run.foregroundOwned !== true ||
      head.foregroundRunId !== run.runId ||
      run.continuationEntryId !== head.activeEntryId ||
      run.boundSelectionEpoch !== head.selectionEpoch
    ) {
      return rejected("provider_preparation_fence_changed");
    }
    const settledWork: CanonicalLifecycleWork = {
      ...work,
      state: "settled",
      revision: work.revision + 1,
      leaseOwner: undefined,
      leaseDeadline: undefined,
      updatedAt: input.now,
    };
    const claimWork: CanonicalLifecycleWork = {
      schemaVersion: 1,
      workId: `canonical_work_${suffix}_claim`,
      conversationId: input.conversationId,
      runId: input.runId,
      kind: "claim_provider_attempt",
      providerPhaseId: phase.phaseId,
      state: "ready",
      inputHash: requestHash,
      generation: 0,
      revision: 1,
      notBefore: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    };
    const nextRun: RunControl = { ...run, revision: run.revision + 1 };
    const outcome = await this.transitions.commit({
      namespaceId: identity.namespaceId,
      executionIncarnationId: identity.executionIncarnationId,
      operationKind: "prepare_provider_request",
      ownerKind: "conversation",
      ownerId: input.conversationId,
      commandId,
      fingerprintVersion: 1,
      fingerprint,
      requireRuntimeDispatchAdmission: true,
      expectedHeads: [
        {
          conversationId: input.conversationId,
          revision: head.revision,
          selectionEpoch: head.selectionEpoch,
        },
      ],
      expectedRunFences: [
        {
          conversationId: input.conversationId,
          runId: input.runId,
          generation: run.generation,
          revision: run.revision,
          selectionEpoch: run.boundSelectionEpoch,
          continuationEntryId: run.continuationEntryId,
          requireForegroundOwnership: true,
        },
      ],
      transitions: [],
      artifactManifests: [
        { manifestId: requestManifestId, schemaVersion: 1, data: requestData },
      ],
      providerPhases: [readyPhase],
      runControls: [nextRun],
      lifecycleWorks: [settledWork, claimWork],
      outcome: { phase: readyPhase, work: claimWork, run: nextRun },
      publicationIntents: [],
      now: input.now,
    });
    if (outcome.kind !== "committed" && outcome.kind !== "receipt_replay") {
      return { kind: "rejected", outcome };
    }
    return {
      kind: outcome.kind,
      phase: readyPhase,
      work: claimWork,
      run: nextRun,
    };
  }
}

function rejected(reason: string): CanonicalProviderPreparationResult {
  return {
    kind: "rejected",
    outcome: { kind: "superseded", reason },
  };
}
