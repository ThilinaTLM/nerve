import { createHash } from "node:crypto";
import type { MutationOutcome } from "@nervekit/contracts/conversations";
import {
  canonicalExecutionAttemptSchema,
  canonicalLifecycleWorkSchema,
  exactCallAuthorizationSchema,
  executionClaimSchema,
  logicalEffectSchema,
  waitGroupSchema,
  type CanonicalExecutionAttempt,
  type CanonicalLifecycleWork,
  type ExactCallAuthorization,
  type ExecutionClaim,
  type LogicalEffect,
  type RunControl,
  type WaitGroup,
} from "@nervekit/contracts/runs";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import { conversationCommandFingerprint } from "./command-fingerprint.js";
import { CanonicalTimelineIdentityService } from "./canonical-timeline-identity.service.js";
import { ConversationTransitionService } from "./conversation-transition.service.js";

export interface CanonicalToolDispatchSnapshot {
  namespaceId: string;
  executionIncarnationId: string;
  conversationId: string;
  runId: string;
  runGeneration: number;
  runRevision: number;
  selectionEpoch: number;
  continuationEntryId: string;
  authorization: ExactCallAuthorization;
  effect: LogicalEffect;
  attempt: CanonicalExecutionAttempt;
  claim: ExecutionClaim;
  work: CanonicalLifecycleWork;
  waitGroup: WaitGroup;
}

export type CanonicalToolDispatchResult =
  | {
      kind: "committed" | "receipt_replay";
      snapshot: CanonicalToolDispatchSnapshot;
    }
  | { kind: "rejected"; outcome: MutationOutcome };

/** Consumes exact authorization while creating one tool dispatch claim. */
export class CanonicalToolDispatchService {
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
    effectId: string;
    now: string;
    claimLeaseDurationMs: number;
  }): Promise<CanonicalToolDispatchResult> {
    const [identity, admission, head, run, effect, work] = await Promise.all([
      this.identity.resolve(),
      this.store.readTimelineRuntimeAdmission(),
      this.store.readTimelineConversationHead(input.conversationId),
      this.store.readTimelineRunControl(input.conversationId, input.runId),
      this.store.execution.readEffect(input.effectId),
      this.store.execution.readLifecycleWork(input.workId),
    ]);
    if (!effect) return rejected("tool_effect_missing");
    const waitGroup = run?.waitGroupId
      ? await this.store.execution.readWaitGroup(run.waitGroupId)
      : undefined;
    const member = waitGroup?.members.find(
      (candidate) => candidate.memberId === effect.memberId,
    );
    const authorization = await this.store.execution.readAuthorization(
      effect.authorizationId,
    );
    const suffix = effect.effectId.slice("effect_".length);
    const attemptId = `attempt_tool_${suffix}_1`;
    const claimId = `claim_tool_${suffix}_1`;
    const commandId = `claim-tool-attempt:${effect.effectId}:1`;
    const fingerprint = conversationCommandFingerprint({
      operation: "claim_tool_attempt",
      effectId: effect.effectId,
      inputHash: effect.normalizedInputFingerprint,
      workId: input.workId,
      workerId: input.workerId,
      claimLeaseDurationMs: input.claimLeaseDurationMs,
    });
    const receipt = await this.store.readTimelineCommandReceipt({
      namespaceId: identity.namespaceId,
      operationKind: "claim_tool_attempt",
      ownerKind: "conversation",
      ownerId: input.conversationId,
      commandId,
      fingerprint,
    });
    if (receipt?.kind === "receipt_replay") {
      return { kind: "receipt_replay", snapshot: parseSnapshot(receipt.value) };
    }
    if (
      !authorization ||
      !waitGroup ||
      !member ||
      member.executionState !== "authorized" ||
      !head ||
      !run ||
      !work ||
      admission?.dispatchState !== "admitted" ||
      admission.executionIncarnationId !== identity.executionIncarnationId ||
      !Number.isSafeInteger(input.claimLeaseDurationMs) ||
      input.claimLeaseDurationMs < 1_000 ||
      input.claimLeaseDurationMs > 300_000 ||
      work.kind !== "claim_tool_attempt" ||
      work.effectId !== effect.effectId ||
      work.state !== "leased" ||
      work.leaseOwner !== input.workerId ||
      Date.parse(work.leaseDeadline ?? "") <= Date.parse(input.now) ||
      effect.state !== "authorized" ||
      authorization.state !== "active" ||
      authorization.normalizedInputFingerprint !==
        effect.normalizedInputFingerprint ||
      authorization.runGeneration !== run.generation ||
      authorization.selectionEpoch !== head.selectionEpoch ||
      run.boundSelectionEpoch !== head.selectionEpoch ||
      run.continuationEntryId !== head.activeEntryId ||
      head.foregroundRunId !== run.runId ||
      !run.foregroundOwned ||
      !head.activeEntryId
    ) {
      return rejected("tool_claim_fence_changed");
    }
    const executingGroup: WaitGroup = {
      ...waitGroup,
      revision: waitGroup.revision + 1,
      members: waitGroup.members.map((candidate) =>
        candidate.memberId === member.memberId
          ? {
              ...candidate,
              executionState: "executing",
              revision: candidate.revision + 1,
            }
          : candidate,
      ),
    };
    const consumedAuthorization: ExactCallAuthorization = {
      ...authorization,
      state: "consumed",
    };
    const dispatchingEffect: LogicalEffect = {
      ...effect,
      state: "dispatching",
    };
    const readyAttempt: CanonicalExecutionAttempt = {
      schemaVersion: 1,
      attemptId,
      effectId: effect.effectId,
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
      token: `tool-claim-${createHash("sha256")
        .update(`${identity.executionIncarnationId}:${attemptId}`)
        .digest("hex")}`,
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
      workId: `canonical_work_${suffix}_dispatch_1`,
      conversationId: input.conversationId,
      runId: input.runId,
      kind: "dispatch_tool_attempt",
      effectId: effect.effectId,
      attemptId,
      executionClaimId: claimId,
      state: "ready",
      inputHash: effect.normalizedInputFingerprint,
      generation: 0,
      revision: 1,
      notBefore: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    };
    const nextRun: RunControl = { ...run, revision: run.revision + 1 };
    const snapshot: CanonicalToolDispatchSnapshot = {
      namespaceId: identity.namespaceId,
      executionIncarnationId: identity.executionIncarnationId,
      conversationId: input.conversationId,
      runId: input.runId,
      runGeneration: run.generation,
      runRevision: nextRun.revision,
      selectionEpoch: head.selectionEpoch,
      continuationEntryId: head.activeEntryId,
      authorization: consumedAuthorization,
      effect: dispatchingEffect,
      attempt,
      claim,
      work: dispatchWork,
      waitGroup: executingGroup,
    };
    const outcome = await this.transitions.commit({
      namespaceId: identity.namespaceId,
      executionIncarnationId: identity.executionIncarnationId,
      operationKind: "claim_tool_attempt",
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
      runControls: [nextRun],
      waitGroups: [executingGroup],
      authorizations: [consumedAuthorization],
      logicalEffects: [dispatchingEffect],
      executionAttempts: [readyAttempt, attempt],
      executionClaims: [claim],
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
    snapshot: CanonicalToolDispatchSnapshot,
    input: { workerId: string; now: string },
  ): Promise<CanonicalToolDispatchResult> {
    const [head, run, authorization, effect, attempt, claim, work] =
      await Promise.all([
        this.store.readTimelineConversationHead(snapshot.conversationId),
        this.store.readTimelineRunControl(
          snapshot.conversationId,
          snapshot.runId,
        ),
        this.store.execution.readAuthorization(
          snapshot.authorization.authorizationId,
        ),
        this.store.execution.readEffect(snapshot.effect.effectId),
        this.store.execution.readAttempt(snapshot.attempt.attemptId),
        this.store.execution.readClaim(snapshot.claim.claimId),
        this.store.execution.readLifecycleWork(snapshot.work.workId),
      ]);
    const commandId = `mark-tool-dispatched:${snapshot.attempt.attemptId}`;
    const fingerprint = conversationCommandFingerprint({
      operation: "mark_tool_dispatched",
      effectId: snapshot.effect.effectId,
      attemptId: snapshot.attempt.attemptId,
      claimId: snapshot.claim.claimId,
      claimToken: snapshot.claim.token,
      workId: snapshot.work.workId,
      workerId: input.workerId,
    });
    const receipt = await this.store.readTimelineCommandReceipt({
      namespaceId: snapshot.namespaceId,
      operationKind: "mark_tool_dispatched",
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
      authorization?.state !== "consumed" ||
      effect?.state !== "dispatching" ||
      attempt?.state !== "claimed" ||
      claim?.state !== "active" ||
      claim.token !== snapshot.claim.token ||
      Date.parse(claim.leaseDeadline) <= Date.parse(input.now) ||
      work?.state !== "leased" ||
      work.leaseOwner !== input.workerId ||
      work.executionClaimId !== claim.claimId ||
      Date.parse(work.leaseDeadline ?? "") <= Date.parse(input.now) ||
      head.activeEntryId !== snapshot.continuationEntryId ||
      head.selectionEpoch !== snapshot.selectionEpoch ||
      head.foregroundRunId !== snapshot.runId ||
      run.generation !== snapshot.runGeneration ||
      run.revision !== snapshot.runRevision ||
      !run.foregroundOwned
    ) {
      return rejected("tool_dispatch_fence_changed");
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
    const nextSnapshot: CanonicalToolDispatchSnapshot = {
      ...snapshot,
      runRevision: nextRun.revision,
      authorization,
      effect,
      attempt: dispatchedAttempt,
      claim,
      work: dispatchedWork,
    };
    const outcome = await this.transitions.commit({
      namespaceId: snapshot.namespaceId,
      executionIncarnationId: snapshot.executionIncarnationId,
      operationKind: "mark_tool_dispatched",
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
    snapshot: CanonicalToolDispatchSnapshot,
    input: { workerId: string; now: string },
  ): Promise<boolean> {
    const [
      identity,
      admission,
      head,
      run,
      authorization,
      effect,
      attempt,
      claim,
      work,
    ] = await Promise.all([
      this.store.readTimelineStateIdentity(),
      this.store.readTimelineRuntimeAdmission(),
      this.store.readTimelineConversationHead(snapshot.conversationId),
      this.store.readTimelineRunControl(
        snapshot.conversationId,
        snapshot.runId,
      ),
      this.store.execution.readAuthorization(
        snapshot.authorization.authorizationId,
      ),
      this.store.execution.readEffect(snapshot.effect.effectId),
      this.store.execution.readAttempt(snapshot.attempt.attemptId),
      this.store.execution.readClaim(snapshot.claim.claimId),
      this.store.execution.readLifecycleWork(snapshot.work.workId),
    ]);
    return Boolean(
      identity?.namespaceId === snapshot.namespaceId &&
      identity.executionIncarnationId === snapshot.executionIncarnationId &&
      admission?.dispatchState === "admitted" &&
      admission.executionIncarnationId === snapshot.executionIncarnationId &&
      head?.activeEntryId === snapshot.continuationEntryId &&
      head.selectionEpoch === snapshot.selectionEpoch &&
      head.foregroundRunId === snapshot.runId &&
      run?.generation === snapshot.runGeneration &&
      run.revision === snapshot.runRevision &&
      run.foregroundOwned &&
      authorization?.state === "consumed" &&
      effect?.state === "dispatching" &&
      attempt?.state === "dispatched" &&
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

function parseSnapshot(value: unknown): CanonicalToolDispatchSnapshot {
  const record = value as Record<string, unknown>;
  return {
    namespaceId: String(record.namespaceId),
    executionIncarnationId: String(record.executionIncarnationId),
    conversationId: String(record.conversationId),
    runId: String(record.runId),
    runGeneration: Number(record.runGeneration),
    runRevision: Number(record.runRevision),
    selectionEpoch: Number(record.selectionEpoch),
    continuationEntryId: String(record.continuationEntryId),
    authorization: exactCallAuthorizationSchema.parse(record.authorization),
    effect: logicalEffectSchema.parse(record.effect),
    attempt: canonicalExecutionAttemptSchema.parse(record.attempt),
    claim: executionClaimSchema.parse(record.claim),
    work: canonicalLifecycleWorkSchema.parse(record.work),
    waitGroup: waitGroupSchema.parse(record.waitGroup),
  };
}

function rejected(reason: string): CanonicalToolDispatchResult {
  return { kind: "rejected", outcome: { kind: "superseded", reason } };
}
