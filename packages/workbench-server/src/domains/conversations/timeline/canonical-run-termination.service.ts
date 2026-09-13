import { createHash } from "node:crypto";
import type {
  CanonicalExecutionAttempt,
  CanonicalLifecycleWork,
  ExecutionClaim,
  ProviderPhase,
  RecoveryAction,
} from "@nervekit/contracts/runs";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import {
  CanonicalRunTimelineService,
  type CanonicalRunMutationResult,
} from "./canonical-run-timeline.service.js";

const terminalAttemptStates = new Set<CanonicalExecutionAttempt["state"]>([
  "succeeded",
  "known_failed",
  "cancelled",
  "outcome_unknown",
  "result_unavailable",
]);

/** Fences a run and closes every uncommitted provider execution right. */
export class CanonicalRunTerminationService {
  private readonly timeline: CanonicalRunTimelineService;

  constructor(private readonly store: CanonicalStore) {
    this.timeline = new CanonicalRunTimelineService(store);
  }

  async close(input: {
    conversationId: string;
    runId: string;
    agentId: string;
    state: "completed" | "failed" | "cancelled" | "abandoned" | "superseded";
    now: string;
    recoveryReason?: string;
  }): Promise<CanonicalRunMutationResult> {
    const run = await this.store.readTimelineRunControl(
      input.conversationId,
      input.runId,
    );
    const authority = await this.store.execution.readRunExecutionAuthority(
      input.runId,
      run?.providerPhaseId ?? undefined,
    );
    const attempts: CanonicalExecutionAttempt[] = [];
    const unknownAttemptIds = new Set<string>();
    for (const attempt of authority.attempts) {
      if (terminalAttemptStates.has(attempt.state)) continue;
      const possibleDispatch = attempt.state === "dispatched";
      if (possibleDispatch) unknownAttemptIds.add(attempt.attemptId);
      attempts.push({
        ...attempt,
        state: possibleDispatch ? "outcome_unknown" : "cancelled",
        outcome: {
          reason: possibleDispatch
            ? "run_closed_after_possible_provider_dispatch"
            : "run_closed_before_provider_dispatch",
          terminalRunState: input.state,
        },
        updatedAt: input.now,
      });
    }
    const claims: ExecutionClaim[] = authority.claims
      .filter((claim) => claim.state === "active")
      .map((claim) => ({ ...claim, state: "revoked" }));
    const work: CanonicalLifecycleWork[] = authority.work
      .filter((item) => item.state !== "settled" && item.state !== "cancelled")
      .map((item) => ({
        ...item,
        state: "cancelled",
        revision: item.revision + 1,
        leaseOwner: undefined,
        leaseDeadline: undefined,
        updatedAt: input.now,
      }));
    const phases: ProviderPhase[] =
      authority.phase &&
      authority.phase.state !== "committed" &&
      authority.phase.state !== "closed"
        ? [{ ...authority.phase, state: "closed" }]
        : [];
    const recoveryActions: RecoveryAction[] = [...unknownAttemptIds].map(
      (attemptId) => {
        const suffix = createHash("sha256")
          .update(`${input.runId}:${attemptId}:possible-dispatch`)
          .digest("hex")
          .slice(0, 32);
        return {
          schemaVersion: 1,
          actionId: `recovery_provider_${suffix}`,
          conversationId: input.conversationId,
          runId: input.runId,
          actionKind: "reconcile_external_effect",
          evidence: {
            source: "provider_attempt",
            attemptId,
            phaseId: authority.phase?.phaseId,
            reason: "run_closed_after_possible_provider_dispatch",
            terminalRunState: input.state,
          },
          status: "prepared",
          commandId: `recover-provider-attempt:${attemptId}`,
          createdAt: input.now,
        };
      },
    );
    return this.timeline.close({
      conversationId: input.conversationId,
      runId: input.runId,
      commandId: `close-canonical-run:${input.runId}:${input.state}`,
      now: input.now,
      actor: { kind: "worker", agentId: input.agentId },
      cause: { kind: "canonical_run_terminated", state: input.state },
      state: input.state,
      recoveryReason: input.recoveryReason,
      providerPhases: phases,
      executionAttempts: attempts,
      executionClaims: claims,
      lifecycleWorks: work,
      recoveryActions,
    });
  }
}
