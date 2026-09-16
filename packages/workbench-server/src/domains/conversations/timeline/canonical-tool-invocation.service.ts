import type { MutationOutcome } from "@nervekit/contracts/conversations";
import type { CanonicalLifecycleWork } from "@nervekit/contracts/runs";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import { CanonicalRunTerminationService } from "./canonical-run-termination.service.js";
import {
  CanonicalToolDispatchService,
  type CanonicalToolDispatchSnapshot,
} from "./canonical-tool-dispatch.service.js";

export type CanonicalToolInvocationResult =
  | { kind: "ready"; snapshot: CanonicalToolDispatchSnapshot }
  | { kind: "rejected"; outcome: MutationOutcome };

/** Advances one claimed tool obligation to immediate fenced dispatch. */
export class CanonicalToolInvocationService {
  private readonly dispatch: CanonicalToolDispatchService;
  private readonly termination: CanonicalRunTerminationService;

  constructor(
    private readonly store: CanonicalStore,
    dispatch?: CanonicalToolDispatchService,
    termination?: CanonicalRunTerminationService,
  ) {
    this.dispatch = dispatch ?? new CanonicalToolDispatchService(store);
    this.termination = termination ?? new CanonicalRunTerminationService(store);
  }

  async prepareForDispatch(input: {
    claimWork: CanonicalLifecycleWork;
    workerId: string;
    now: string;
    schedulerLeaseDurationMs?: number;
    executionClaimDurationMs?: number;
    revalidatePolicy(input: {
      effectId: string;
      authorizationId: string;
      normalizedInputFingerprint: string;
    }): Promise<boolean>;
  }): Promise<CanonicalToolInvocationResult> {
    const initial = input.claimWork;
    if (
      initial.kind !== "claim_tool_attempt" ||
      initial.state !== "leased" ||
      initial.leaseOwner !== input.workerId ||
      !initial.effectId
    ) {
      return rejected("tool_claim_work_invalid");
    }
    const effectId = initial.effectId;
    const effect = await this.store.execution.readEffect(effectId);
    if (!effect) return rejected("tool_effect_missing");
    if (
      !(await input.revalidatePolicy({
        effectId: effect.effectId,
        authorizationId: effect.authorizationId,
        normalizedInputFingerprint: effect.normalizedInputFingerprint,
      }))
    ) {
      return rejected("tool_policy_observation_changed");
    }
    const authorize = () =>
      this.dispatch.authorizeFirstAttempt({
        workId: initial.workId,
        workerId: input.workerId,
        conversationId: initial.conversationId,
        runId: initial.runId,
        effectId,
        now: input.now,
        claimLeaseDurationMs: input.executionClaimDurationMs ?? 300_000,
      });
    let authorized = await authorize();
    for (
      let retry = 1;
      retry < 32 &&
      authorized.kind === "rejected" &&
      isConcurrentConflict(authorized.outcome);
      retry += 1
    ) {
      authorized = await authorize();
    }
    if (authorized.kind === "rejected") return authorized;
    const dispatchWork = await this.store.execution.claimReadyLifecycleWork({
      workId: authorized.snapshot.work.workId,
      workerId: input.workerId,
      now: input.now,
      leaseDurationMs: input.schedulerLeaseDurationMs ?? 300_000,
    });
    if (!dispatchWork) return rejected("tool_dispatch_work_unavailable");
    const markDispatched = () =>
      this.dispatch.markDispatched(
        { ...authorized.snapshot, work: dispatchWork },
        { workerId: input.workerId, now: input.now },
      );
    let dispatched = await markDispatched();
    for (
      let retry = 1;
      retry < 32 &&
      dispatched.kind === "rejected" &&
      isConcurrentConflict(dispatched.outcome);
      retry += 1
    ) {
      dispatched = await markDispatched();
    }
    if (dispatched.kind === "rejected") return dispatched;
    if (
      await this.dispatch.revalidateBeforeDispatch(dispatched.snapshot, {
        workerId: input.workerId,
        now: input.now,
      })
    ) {
      return { kind: "ready", snapshot: dispatched.snapshot };
    }
    await this.termination.close({
      conversationId: initial.conversationId,
      runId: initial.runId,
      agentId: String(effect.owner.agentId ?? "agent_unknown"),
      state: "failed",
      recoveryReason: "tool_pre_dispatch_revalidation_failed",
      now: input.now,
    });
    return rejected("tool_pre_dispatch_revalidation_failed");
  }
}

function isConcurrentConflict(outcome: MutationOutcome): boolean {
  return (
    outcome.kind === "cas_conflict" ||
    (outcome.kind === "superseded" && outcome.reason === "run_fence_changed")
  );
}

function rejected(reason: string): CanonicalToolInvocationResult {
  return { kind: "rejected", outcome: { kind: "superseded", reason } };
}
