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

  constructor(private readonly store: CanonicalStore) {
    this.dispatch = new CanonicalToolDispatchService(store);
    this.termination = new CanonicalRunTerminationService(store);
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
    const effect = await this.store.execution.readEffect(initial.effectId);
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
    const authorized = await this.dispatch.authorizeFirstAttempt({
      workId: initial.workId,
      workerId: input.workerId,
      conversationId: initial.conversationId,
      runId: initial.runId,
      effectId: initial.effectId,
      now: input.now,
      claimLeaseDurationMs: input.executionClaimDurationMs ?? 60_000,
    });
    if (authorized.kind === "rejected") return authorized;
    const dispatchWork = await this.store.execution.claimReadyLifecycleWork({
      workId: authorized.snapshot.work.workId,
      workerId: input.workerId,
      now: input.now,
      leaseDurationMs: input.schedulerLeaseDurationMs ?? 30_000,
    });
    if (!dispatchWork) return rejected("tool_dispatch_work_unavailable");
    if (
      !(await input.revalidatePolicy({
        effectId: effect.effectId,
        authorizationId: effect.authorizationId,
        normalizedInputFingerprint: effect.normalizedInputFingerprint,
      }))
    ) {
      await this.termination.close({
        conversationId: initial.conversationId,
        runId: initial.runId,
        agentId: String(effect.owner.agentId ?? "agent_unknown"),
        state: "failed",
        recoveryReason: "tool_policy_changed_before_dispatch",
        now: input.now,
      });
      return rejected("tool_policy_changed_before_dispatch");
    }
    const dispatched = await this.dispatch.markDispatched(
      { ...authorized.snapshot, work: dispatchWork },
      { workerId: input.workerId, now: input.now },
    );
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

function rejected(reason: string): CanonicalToolInvocationResult {
  return { kind: "rejected", outcome: { kind: "superseded", reason } };
}
