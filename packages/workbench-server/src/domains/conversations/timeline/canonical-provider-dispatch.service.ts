import { createHash } from "node:crypto";
import {
  canonicalExecutionAttemptSchema,
  canonicalLifecycleWorkSchema,
  executionClaimSchema,
  providerPhaseSchema,
  type CanonicalExecutionAttempt,
  type CanonicalLifecycleWork,
  type ExecutionClaim,
  type ProviderPhase,
  type RunControl,
} from "@nervekit/contracts/runs";
import type { MutationOutcome } from "@nervekit/contracts/conversations";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import { conversationCommandFingerprint } from "./command-fingerprint.js";
import { CanonicalTimelineIdentityService } from "./canonical-timeline-identity.service.js";
import { ConversationTransitionService } from "./conversation-transition.service.js";

export interface CanonicalProviderDispatchSnapshot {
  namespaceId: string;
  executionIncarnationId: string;
  conversationId: string;
  runId: string;
  runGeneration: number;
  runRevision: number;
  selectionEpoch: number;
  sourceEntryId: string;
  phase: ProviderPhase;
  attempt: CanonicalExecutionAttempt;
  claim: ExecutionClaim;
  work: CanonicalLifecycleWork;
}

export type CanonicalProviderDispatchResult =
  | {
      kind: "committed" | "receipt_replay";
      snapshot: CanonicalProviderDispatchSnapshot;
    }
  | { kind: "rejected"; outcome: MutationOutcome };

/** Converts claim work into the sole fenced provider-dispatch authority. */
export class CanonicalProviderDispatchService {
  private readonly identity: CanonicalTimelineIdentityService;
  private readonly transitions: ConversationTransitionService;

  constructor(private readonly store: CanonicalStore) {
    this.identity = new CanonicalTimelineIdentityService(store);
    this.transitions = new ConversationTransitionService(store);
  }

  async authorizeFirstAttempt(input: {
    workId: string;
    workerId: string;
    conversationId: string;
    runId: string;
    phaseId: string;
    now: string;
    claimLeaseDurationMs: number;
  }): Promise<CanonicalProviderDispatchResult> {
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
    const attemptId = `attempt_provider_${suffix}_1`;
    const claimId = `claim_provider_${suffix}_1`;
    const dispatchWorkId = `canonical_work_${suffix}_dispatch_1`;
    const commandId = `claim-provider-attempt:${phase.phaseId}:1`;
    const fingerprint = conversationCommandFingerprint({
      operation: "claim_provider_attempt",
      phaseId: phase.phaseId,
      requestHash: phase.requestHash,
      workId: input.workId,
      workerId: input.workerId,
      claimLeaseDurationMs: input.claimLeaseDurationMs,
    });
    const receipt = await this.store.readTimelineCommandReceipt({
      namespaceId: identity.namespaceId,
      operationKind: "claim_provider_attempt",
      ownerKind: "conversation",
      ownerId: input.conversationId,
      commandId,
      fingerprint,
    });
    if (receipt?.kind === "receipt_replay") {
      return {
        kind: "receipt_replay",
        snapshot: parseSnapshot(receipt.value),
      };
    }
    if (
      !Number.isSafeInteger(input.claimLeaseDurationMs) ||
      input.claimLeaseDurationMs < 1_000 ||
      input.claimLeaseDurationMs > 300_000 ||
      admission?.dispatchState !== "admitted" ||
      admission.executionIncarnationId !== identity.executionIncarnationId ||
      !head ||
      !run ||
      !work ||
      work.kind !== "claim_provider_attempt" ||
      work.providerPhaseId !== phase.phaseId ||
      work.state !== "leased" ||
      work.leaseOwner !== input.workerId ||
      Date.parse(work.leaseDeadline ?? "") <= Date.parse(input.now) ||
      phase.state !== "ready" ||
      !phase.requestHash ||
      !phase.requestManifestId ||
      run.providerPhaseId !== phase.phaseId ||
      !run.foregroundOwned ||
      head.foregroundRunId !== run.runId ||
      run.continuationEntryId !== head.activeEntryId ||
      run.boundSelectionEpoch !== head.selectionEpoch ||
      !head.activeEntryId
    ) {
      return rejected("provider_claim_fence_changed");
    }
    const activePhase: ProviderPhase = { ...phase, state: "active" };
    const readyAttempt: CanonicalExecutionAttempt = {
      schemaVersion: 1,
      attemptId,
      providerPhaseId: phase.phaseId,
      attemptNumber: 1,
      executionIncarnationId: identity.executionIncarnationId,
      state: "ready",
      createdAt: input.now,
      updatedAt: input.now,
    };
    const attempt: CanonicalExecutionAttempt = {
      ...readyAttempt,
      state: "claimed",
    };
    const claim: ExecutionClaim = {
      schemaVersion: 1,
      claimId,
      attemptId,
      token: createClaimToken(identity.executionIncarnationId, attemptId),
      generation: 1,
      executionIncarnationId: identity.executionIncarnationId,
      leaseDeadline: new Date(
        Date.parse(input.now) + input.claimLeaseDurationMs,
      ).toISOString(),
      state: "active",
    };
    const settledWork: CanonicalLifecycleWork = {
      ...work,
      state: "settled",
      revision: work.revision + 1,
      leaseOwner: undefined,
      leaseDeadline: undefined,
      updatedAt: input.now,
    };
    const dispatchWork: CanonicalLifecycleWork = {
      schemaVersion: 1,
      workId: dispatchWorkId,
      conversationId: input.conversationId,
      runId: input.runId,
      kind: "dispatch_provider_attempt",
      providerPhaseId: phase.phaseId,
      attemptId,
      executionClaimId: claimId,
      state: "ready",
      inputHash: phase.requestHash,
      generation: 0,
      revision: 1,
      notBefore: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    };
    const nextRun: RunControl = { ...run, revision: run.revision + 1 };
    const snapshot: CanonicalProviderDispatchSnapshot = {
      namespaceId: identity.namespaceId,
      executionIncarnationId: identity.executionIncarnationId,
      conversationId: input.conversationId,
      runId: input.runId,
      runGeneration: run.generation,
      runRevision: nextRun.revision,
      selectionEpoch: head.selectionEpoch,
      sourceEntryId: head.activeEntryId,
      phase: activePhase,
      attempt,
      claim,
      work: dispatchWork,
    };
    const outcome = await this.transitions.commit({
      namespaceId: identity.namespaceId,
      executionIncarnationId: identity.executionIncarnationId,
      operationKind: "claim_provider_attempt",
      ownerKind: "conversation",
      ownerId: input.conversationId,
      commandId,
      fingerprintVersion: 1,
      fingerprint,
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
      providerPhases: [activePhase],
      executionAttempts: [readyAttempt, attempt],
      executionClaims: [claim],
      runControls: [nextRun],
      lifecycleWorks: [settledWork, dispatchWork],
      outcome: snapshot,
      publicationIntents: [],
      now: input.now,
    });
    return outcome.kind === "committed"
      ? { kind: "committed", snapshot }
      : outcome.kind === "receipt_replay"
        ? { kind: "receipt_replay", snapshot: parseSnapshot(outcome.value) }
        : { kind: "rejected", outcome };
  }

  async markDispatched(
    snapshot: CanonicalProviderDispatchSnapshot,
    input: { workerId: string; now: string },
  ): Promise<CanonicalProviderDispatchResult> {
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
    const commandId = `mark-provider-dispatched:${snapshot.attempt.attemptId}`;
    const fingerprint = conversationCommandFingerprint({
      operation: "mark_provider_dispatched",
      phaseId: snapshot.phase.phaseId,
      attemptId: snapshot.attempt.attemptId,
      claimId: snapshot.claim.claimId,
      claimToken: snapshot.claim.token,
      workId: snapshot.work.workId,
      workerId: input.workerId,
    });
    const receipt = await this.store.readTimelineCommandReceipt({
      namespaceId: snapshot.namespaceId,
      operationKind: "mark_provider_dispatched",
      ownerKind: "conversation",
      ownerId: snapshot.conversationId,
      commandId,
      fingerprint,
    });
    if (receipt?.kind === "receipt_replay") {
      return { kind: "receipt_replay", snapshot: parseSnapshot(receipt.value) };
    }
    if (
      !head ||
      !run ||
      phase?.state !== "active" ||
      attempt?.state !== "claimed" ||
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
      return rejected("provider_dispatch_fence_changed");
    }
    const dispatchedAttempt: CanonicalExecutionAttempt = {
      ...attempt,
      state: "dispatched",
      updatedAt: input.now,
    };
    const dispatchedWork: CanonicalLifecycleWork = {
      ...work,
      revision: work.revision + 1,
      updatedAt: input.now,
    };
    const nextRun: RunControl = { ...run, revision: run.revision + 1 };
    const nextSnapshot: CanonicalProviderDispatchSnapshot = {
      ...snapshot,
      runRevision: nextRun.revision,
      attempt: dispatchedAttempt,
      claim,
      work: dispatchedWork,
    };
    const outcome = await this.transitions.commit({
      namespaceId: snapshot.namespaceId,
      executionIncarnationId: snapshot.executionIncarnationId,
      operationKind: "mark_provider_dispatched",
      ownerKind: "conversation",
      ownerId: snapshot.conversationId,
      commandId,
      fingerprintVersion: 1,
      fingerprint,
      expectedHeads: [
        {
          conversationId: snapshot.conversationId,
          revision: head.revision,
          selectionEpoch: head.selectionEpoch,
        },
      ],
      expectedRunFences: [
        {
          conversationId: snapshot.conversationId,
          runId: snapshot.runId,
          generation: run.generation,
          revision: run.revision,
          selectionEpoch: run.boundSelectionEpoch,
          continuationEntryId: run.continuationEntryId,
          requireForegroundOwnership: true,
        },
      ],
      transitions: [],
      runControls: [nextRun],
      executionAttempts: [dispatchedAttempt],
      lifecycleWorks: [dispatchedWork],
      outcome: nextSnapshot,
      publicationIntents: [],
      now: input.now,
    });
    return outcome.kind === "committed"
      ? { kind: "committed", snapshot: nextSnapshot }
      : outcome.kind === "receipt_replay"
        ? { kind: "receipt_replay", snapshot: parseSnapshot(outcome.value) }
        : { kind: "rejected", outcome };
  }

  async revalidateBeforeDispatch(
    snapshot: CanonicalProviderDispatchSnapshot,
    input: { workerId: string; now: string },
  ): Promise<boolean> {
    const [identity, admission, head, run, phase, attempt, claim, work] =
      await Promise.all([
        this.store.readTimelineStateIdentity(),
        this.store.readTimelineRuntimeAdmission(),
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
    return Boolean(
      identity?.namespaceId === snapshot.namespaceId &&
      identity.executionIncarnationId === snapshot.executionIncarnationId &&
      admission?.dispatchState === "admitted" &&
      admission.executionIncarnationId === snapshot.executionIncarnationId &&
      head?.activeEntryId === snapshot.sourceEntryId &&
      head.selectionEpoch === snapshot.selectionEpoch &&
      head.foregroundRunId === snapshot.runId &&
      run?.generation === snapshot.runGeneration &&
      run.revision === snapshot.runRevision &&
      run.providerPhaseId === snapshot.phase.phaseId &&
      run.foregroundOwned &&
      phase?.state === "active" &&
      phase.requestHash === snapshot.phase.requestHash &&
      attempt?.state === "dispatched" &&
      attempt.executionIncarnationId === snapshot.executionIncarnationId &&
      claim?.state === "active" &&
      claim.token === snapshot.claim.token &&
      Date.parse(claim.leaseDeadline) > Date.parse(input.now) &&
      work?.state === "leased" &&
      work.leaseOwner === input.workerId &&
      work.executionClaimId === claim.claimId &&
      Date.parse(work.leaseDeadline ?? "") > Date.parse(input.now),
    );
  }
}

function createClaimToken(incarnationId: string, attemptId: string): string {
  return `provider-claim-${createHash("sha256")
    .update(`${incarnationId}:${attemptId}`)
    .digest("hex")}`;
}

function parseSnapshot(value: unknown): CanonicalProviderDispatchSnapshot {
  const record = value as Record<string, unknown>;
  return {
    namespaceId: String(record.namespaceId),
    executionIncarnationId: String(record.executionIncarnationId),
    conversationId: String(record.conversationId),
    runId: String(record.runId),
    runGeneration: Number(record.runGeneration),
    runRevision: Number(record.runRevision),
    selectionEpoch: Number(record.selectionEpoch),
    sourceEntryId: String(record.sourceEntryId),
    phase: providerPhaseSchema.parse(record.phase),
    attempt: canonicalExecutionAttemptSchema.parse(record.attempt),
    claim: executionClaimSchema.parse(record.claim),
    work: canonicalLifecycleWorkSchema.parse(record.work),
  };
}

function rejected(reason: string): CanonicalProviderDispatchResult {
  return { kind: "rejected", outcome: { kind: "superseded", reason } };
}
