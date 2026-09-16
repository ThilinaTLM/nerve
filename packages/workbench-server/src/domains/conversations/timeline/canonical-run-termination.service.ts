import { createHash } from "node:crypto";
import type {
  CanonicalExecutionAttempt,
  CanonicalLifecycleWork,
  ExactCallAuthorization,
  ExecutionClaim,
  LogicalEffect,
  ProviderPhase,
  RecoveryAction,
  WaitGroup,
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
    projectId?: string;
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
    const unknownEffectIds = new Set(
      authority.attempts
        .filter((attempt) => unknownAttemptIds.has(attempt.attemptId))
        .flatMap((attempt) => (attempt.effectId ? [attempt.effectId] : [])),
    );
    const authorizations: ExactCallAuthorization[] = authority.authorizations
      .filter((authorization) => authorization.state === "active")
      .map((authorization) => ({ ...authorization, state: "revoked" }));
    const effects: LogicalEffect[] = authority.effects
      .filter(
        (effect) =>
          effect.state !== "closed" && effect.state !== "outcome_unknown",
      )
      .map((effect) => ({
        ...effect,
        state: unknownEffectIds.has(effect.effectId)
          ? "outcome_unknown"
          : "closed",
      }));
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
    const waitGroups: WaitGroup[] = authority.waitGroup
      ? [
          closeWaitGroup(
            authority.waitGroup,
            unknownEffectIds,
            authority.effects,
          ),
        ]
      : [];
    const phases: ProviderPhase[] =
      authority.phase &&
      authority.phase.state !== "committed" &&
      authority.phase.state !== "closed"
        ? [{ ...authority.phase, state: "closed" }]
        : [];
    const recoveryActions: RecoveryAction[] = [...unknownAttemptIds].map(
      (attemptId) => {
        const attempt = authority.attempts.find(
          (candidate) => candidate.attemptId === attemptId,
        );
        const suffix = createHash("sha256")
          .update(`${input.runId}:${attemptId}:possible-dispatch`)
          .digest("hex")
          .slice(0, 32);
        return {
          schemaVersion: 1,
          actionId: `recovery_execution_${suffix}`,
          conversationId: input.conversationId,
          runId: input.runId,
          ...(attempt?.effectId ? { effectId: attempt.effectId } : {}),
          actionKind: "reconcile_external_effect",
          evidence: {
            source: attempt?.effectId ? "tool_attempt" : "provider_attempt",
            attemptId,
            effectId: attempt?.effectId,
            phaseId: attempt?.providerPhaseId,
            reason: "run_closed_after_possible_provider_dispatch",
            terminalRunState: input.state,
          },
          status: "prepared",
          commandId: `recover-execution-attempt:${attemptId}`,
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
      waitGroups,
      authorizations,
      logicalEffects: effects,
      executionAttempts: attempts,
      executionClaims: claims,
      lifecycleWorks: work,
      recoveryActions,
      publicationIntents: input.projectId
        ? [terminalRunPublication(input, run?.continuationEntryId ?? undefined)]
        : [],
    });
  }
}

function terminalRunPublication(
  input: {
    conversationId: string;
    runId: string;
    agentId: string;
    projectId?: string;
    state: "completed" | "failed" | "cancelled" | "abandoned" | "superseded";
    now: string;
    recoveryReason?: string;
  },
  finalEntryId?: string,
) {
  const common = {
    conversationId: input.conversationId,
    agentId: input.agentId,
    projectId: input.projectId!,
    runId: input.runId,
  };
  if (input.state === "completed") {
    return {
      intentId: `evt_run_completed_${input.runId}`,
      stream: `conv/${input.conversationId}`,
      eventType: "run.completed",
      occurredAt: input.now,
      conversationId: input.conversationId,
      data: {
        ...common,
        ...(finalEntryId ? { finalEntryId } : {}),
        completedAt: input.now,
      },
    };
  }
  if (input.state === "cancelled") {
    return {
      intentId: `evt_run_cancelled_${input.runId}`,
      stream: `conv/${input.conversationId}`,
      eventType: "run.cancelled",
      occurredAt: input.now,
      conversationId: input.conversationId,
      data: { ...common, cancelledAt: input.now },
    };
  }
  return {
    intentId: `evt_run_failed_${input.runId}`,
    stream: `conv/${input.conversationId}`,
    eventType: "run.failed",
    occurredAt: input.now,
    conversationId: input.conversationId,
    data: {
      ...common,
      message: input.recoveryReason ?? `Run ${input.state}.`,
      aborted: input.state !== "failed",
      interrupted: input.state !== "failed",
      failedAt: input.now,
    },
  };
}

function closeWaitGroup(
  group: WaitGroup,
  unknownEffectIds: ReadonlySet<string>,
  effects: readonly LogicalEffect[],
): WaitGroup {
  const effectByMember = new Map(
    effects.map((effect) => [effect.memberId, effect.effectId]),
  );
  const members = group.members.map((member) => {
    if (
      member.executionState === "succeeded" ||
      member.executionState === "known_failed" ||
      member.executionState === "denied" ||
      member.executionState === "cancelled" ||
      member.executionState === "closed"
    ) {
      return member;
    }
    const unknown =
      member.executionState === "outcome_unknown" ||
      unknownEffectIds.has(effectByMember.get(member.memberId) ?? "");
    return unknown
      ? {
          ...member,
          executionState: "outcome_unknown" as const,
          attachmentDisposition: "outcome_unknown" as const,
          contributesToBarrier: false,
          revision: member.revision + 1,
        }
      : {
          ...member,
          executionState: "cancelled" as const,
          attachmentDisposition: "not_executed" as const,
          nonDispatchEvidenceId: `evidence_cancelled_${member.memberId.slice("member_".length)}`,
          contributesToBarrier: true,
          revision: member.revision + 1,
        };
  });
  const hasUnknown = members.some(
    (member) => member.executionState === "outcome_unknown",
  );
  return {
    ...group,
    members,
    continuationConsumed: true,
    state: hasUnknown ? "recovery_required" : "closed",
    revision: group.revision + 1,
  };
}
