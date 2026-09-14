import { createHash } from "node:crypto";
import type { MutationOutcome } from "@nervekit/contracts/conversations";
import type {
  CanonicalExecutionAttempt,
  CanonicalLifecycleWork,
  ExecutionClaim,
  ProviderPhase,
} from "@nervekit/contracts/runs";
import type { AppendEntryDraft } from "./transition-builders.js";
import { canonicalConversationJson } from "./command-fingerprint.js";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import type { CanonicalProviderDispatchSnapshot } from "./canonical-provider-dispatch.service.js";
import { CanonicalRunTimelineService } from "./canonical-run-timeline.service.js";
import {
  buildCanonicalToolBatch,
  type CanonicalToolProposalInput,
} from "./canonical-tool-batch.js";

const MAX_CANONICAL_PROVIDER_RETRIES = 3;

export type CanonicalProviderSettlementResult =
  | { kind: "committed" | "receipt_replay"; responseId: string }
  | { kind: "rejected"; outcome: MutationOutcome };

/** Attaches one complete provider response and consumes its claim exactly once. */
export class CanonicalProviderSettlementService {
  private readonly timeline: CanonicalRunTimelineService;

  constructor(private readonly store: CanonicalStore) {
    this.timeline = new CanonicalRunTimelineService(store);
  }

  async commitKnownFailure(input: {
    snapshot: CanonicalProviderDispatchSnapshot;
    workerId: string;
    error: string;
    retryAt: string;
    now: string;
  }): Promise<CanonicalProviderSettlementResult> {
    const { snapshot } = input;
    const [head, run, phase, attempt, claim, work] = await Promise.all([
      this.store.readTimelineConversationHead(snapshot.conversationId),
      this.store.readTimelineRunControl(
        snapshot.conversationId,
        snapshot.runId,
      ),
      this.store.execution.readProviderPhase(snapshot.phase.phaseId),
      this.store.execution.readAttempt(snapshot.attempt.attemptId),
      this.store.execution.readClaim(snapshot.claim.claimId),
      this.store.execution.readLifecycleWork(snapshot.work.workId),
    ]);
    const replayCandidate =
      phase?.state === "closed" &&
      attempt?.state === "known_failed" &&
      claim?.state === "consumed" &&
      work?.state === "settled";
    if (
      !head ||
      !run ||
      (!replayCandidate &&
        (phase?.state !== "active" ||
          attempt?.state !== "dispatched" ||
          claim?.state !== "active" ||
          work?.state !== "leased" ||
          work.leaseOwner !== input.workerId ||
          head.activeEntryId !== snapshot.sourceEntryId ||
          head.foregroundRunId !== snapshot.runId ||
          run.revision !== snapshot.runRevision))
    ) {
      return rejected("provider_failure_fence_changed");
    }
    if (!phase || !attempt || !claim || !work) {
      return rejected("provider_failure_authority_missing");
    }
    const retryNumber =
      typeof phase.providerIdentity.canonicalRetryNumber === "number"
        ? phase.providerIdentity.canonicalRetryNumber + 1
        : 1;
    if (retryNumber > MAX_CANONICAL_PROVIDER_RETRIES) {
      const exhausted = await this.timeline.append({
        conversationId: run.conversationId,
        runId: run.runId,
        commandId: `retry-provider:${phase.phaseId}`,
        now: input.now,
        actor: { kind: "worker", workerId: input.workerId },
        cause: { kind: "provider_retry_exhausted", phaseId: phase.phaseId },
        entries: [],
        providerPhases: [{ ...snapshot.phase, state: "closed" }],
        executionAttempts: [
          {
            ...snapshot.attempt,
            state: "known_failed",
            outcome: { error: input.error, retryNumber, exhausted: true },
            updatedAt: input.now,
          },
        ],
        executionClaims: [{ ...snapshot.claim, state: "consumed" }],
        lifecycleWorks: [
          {
            ...snapshot.work,
            state: "settled",
            revision: snapshot.work.revision + 1,
            leaseOwner: undefined,
            leaseDeadline: undefined,
            updatedAt: input.now,
          },
        ],
        providerPhaseId: null,
        runState: "recovery_required",
      });
      return exhausted.kind === "rejected"
        ? exhausted
        : {
            kind: exhausted.kind,
            responseId: `response_retry_exhausted_${phase.phaseId}`,
          };
    }
    const suffix = createHash("sha256")
      .update(`${phase.phaseId}:${retryNumber}`)
      .digest("hex")
      .slice(0, 32);
    const nextPhaseId = `provider_phase_retry_${suffix}`;
    const nextPhase: ProviderPhase = {
      schemaVersion: 1,
      phaseId: nextPhaseId,
      runId: run.runId,
      runGeneration: run.generation,
      selectionEpoch: head.selectionEpoch,
      sourceEntryId: head.activeEntryId,
      contextRecipeId: `context_recipe_retry_${suffix}`,
      providerIdentity: {
        ...phase.providerIdentity,
        canonicalRetryNumber: retryNumber,
      },
      capability: phase.capability,
      state: "preparing",
    };
    const decision = {
      schemaVersion: 1,
      priorPhaseId: phase.phaseId,
      priorAttemptId: attempt.attemptId,
      retryNumber,
      error: input.error,
    };
    const decisionHash = `sha256:${createHash("sha256")
      .update(canonicalConversationJson(decision))
      .digest("hex")}`;
    const nextWork: CanonicalLifecycleWork = {
      schemaVersion: 1,
      workId: `canonical_work_retry_${suffix}`,
      conversationId: run.conversationId,
      runId: run.runId,
      kind: "prepare_provider_request",
      providerPhaseId: nextPhaseId,
      state: "ready",
      inputHash: decisionHash,
      inputManifestId: `manifest_provider_retry_${suffix}`,
      generation: 0,
      revision: 1,
      notBefore: input.retryAt,
      createdAt: input.now,
      updatedAt: input.now,
    };
    const result = await this.timeline.append({
      conversationId: run.conversationId,
      runId: run.runId,
      commandId: `retry-provider:${phase.phaseId}`,
      now: input.now,
      actor: { kind: "worker", workerId: input.workerId },
      cause: { kind: "known_provider_failure", phaseId: phase.phaseId },
      entries: [],
      artifactManifests: [
        {
          manifestId: nextWork.inputManifestId!,
          schemaVersion: 1,
          data: decision,
        },
      ],
      providerPhases: [{ ...snapshot.phase, state: "closed" }, nextPhase],
      executionAttempts: [
        {
          ...snapshot.attempt,
          state: "known_failed",
          outcome: { error: input.error, retryNumber },
          updatedAt: input.now,
        },
      ],
      executionClaims: [{ ...snapshot.claim, state: "consumed" }],
      lifecycleWorks: [
        {
          ...snapshot.work,
          state: "settled",
          revision: snapshot.work.revision + 1,
          leaseOwner: undefined,
          leaseDeadline: undefined,
          updatedAt: input.now,
        },
        nextWork,
      ],
      providerPhaseId: nextPhaseId,
      runState: "running",
    });
    return result.kind === "rejected"
      ? result
      : { kind: result.kind, responseId: `response_retry_${suffix}` };
  }

  async commitResponse(input: {
    snapshot: CanonicalProviderDispatchSnapshot;
    workerId: string;
    response: unknown;
    entries: readonly AppendEntryDraft[];
    toolProposals?: readonly CanonicalToolProposalInput[];
    now: string;
  }): Promise<CanonicalProviderSettlementResult> {
    const snapshot = input.snapshot;
    const [head, run, phase, attempt, claim, work] = await Promise.all([
      this.store.readTimelineConversationHead(snapshot.conversationId),
      this.store.readTimelineRunControl(
        snapshot.conversationId,
        snapshot.runId,
      ),
      this.store.execution.readProviderPhase(snapshot.phase.phaseId),
      this.store.execution.readAttempt(snapshot.attempt.attemptId),
      this.store.execution.readClaim(snapshot.claim.claimId),
      this.store.execution.readLifecycleWork(snapshot.work.workId),
    ]);
    if (
      !head ||
      !run ||
      phase?.state !== "active" ||
      attempt?.state !== "dispatched" ||
      claim?.state !== "active" ||
      claim.token !== snapshot.claim.token ||
      Date.parse(claim.leaseDeadline) <= Date.parse(input.now) ||
      work?.state !== "leased" ||
      work.leaseOwner !== input.workerId ||
      work.executionClaimId !== claim.claimId ||
      Date.parse(work.leaseDeadline ?? "") <= Date.parse(input.now) ||
      head.activeEntryId !== snapshot.sourceEntryId ||
      head.selectionEpoch !== snapshot.selectionEpoch ||
      head.foregroundRunId !== snapshot.runId ||
      run.generation !== snapshot.runGeneration ||
      run.revision !== snapshot.runRevision ||
      !run.foregroundOwned
    ) {
      return rejected("provider_settlement_fence_changed");
    }
    const suffix = phase.phaseId.slice("provider_phase_".length);
    const responseData = {
      schemaVersion: 1,
      phaseId: phase.phaseId,
      attemptId: attempt.attemptId,
      requestHash: phase.requestHash,
      response: input.response,
      entries: input.entries,
    };
    const responseDigest = createHash("sha256")
      .update(canonicalConversationJson(responseData))
      .digest("hex");
    const responseId = `response_${responseDigest.slice(0, 40)}`;
    const responseManifestId = `manifest_provider_response_${suffix}`;
    const preparedPhase: ProviderPhase = {
      ...phase,
      state: "response_prepared",
    };
    const committedPhase: ProviderPhase = {
      ...preparedPhase,
      state: "committed",
      committedResponseId: responseId,
    };
    const succeededAttempt: CanonicalExecutionAttempt = {
      ...attempt,
      state: "succeeded",
      outcome: { responseId, responseDigest: `sha256:${responseDigest}` },
      preparedManifestId: responseManifestId,
      updatedAt: input.now,
    };
    const consumedClaim: ExecutionClaim = { ...claim, state: "consumed" };
    const settledWork: CanonicalLifecycleWork = {
      ...work,
      state: "settled",
      revision: work.revision + 1,
      leaseOwner: undefined,
      leaseDeadline: undefined,
      updatedAt: input.now,
    };
    const toolProposals = input.toolProposals ?? [];
    const continuationEntryId = input.entries.at(-1)?.entryId;
    if (toolProposals.length > 0 && !continuationEntryId) {
      throw new Error(
        "A provider tool batch requires an explicit response entry identity.",
      );
    }
    const toolBatch = continuationEntryId
      ? buildCanonicalToolBatch({
          conversationId: snapshot.conversationId,
          runId: snapshot.runId,
          runGeneration: snapshot.runGeneration,
          selectionEpoch: snapshot.selectionEpoch,
          continuationEntryId,
          phaseId: phase.phaseId,
          providerIdentity: phase.providerIdentity,
          providerCapability: phase.capability,
          proposals: toolProposals,
          now: input.now,
        })
      : undefined;
    const result = await this.timeline.append({
      conversationId: snapshot.conversationId,
      runId: snapshot.runId,
      commandId: `commit-provider-response:${phase.phaseId}`,
      now: input.now,
      actor: { kind: "worker", workerId: input.workerId },
      cause: {
        kind: "provider_response_committed",
        phaseId: phase.phaseId,
        attemptId: attempt.attemptId,
        responseId,
      },
      entries: input.entries,
      artifactManifests: [
        {
          manifestId: responseManifestId,
          schemaVersion: 1,
          data: responseData,
        },
        ...(toolBatch?.inputManifests ?? []),
      ],
      providerPhases: [preparedPhase, committedPhase],
      executionAttempts: [succeededAttempt],
      executionClaims: [consumedClaim],
      lifecycleWorks: [settledWork, ...(toolBatch?.work ?? [])],
      waitGroups: toolBatch ? [toolBatch.waitGroup] : [],
      policyObservations: toolBatch?.policyObservations ?? [],
      policyDiagnostics: toolBatch?.policyDiagnostics ?? [],
      authorizations: toolBatch?.authorizations ?? [],
      logicalEffects: toolBatch?.effects ?? [],
      providerPhaseId: null,
      waitGroupId: toolBatch?.waitGroup.waitGroupId ?? null,
      runState: toolBatch
        ? toolBatch.waitGroup.state === "ready"
          ? "waiting"
          : "partially_waiting"
        : "running",
    });
    return result.kind === "rejected"
      ? result
      : { kind: result.kind, responseId };
  }
}

function rejected(reason: string): CanonicalProviderSettlementResult {
  return { kind: "rejected", outcome: { kind: "superseded", reason } };
}
