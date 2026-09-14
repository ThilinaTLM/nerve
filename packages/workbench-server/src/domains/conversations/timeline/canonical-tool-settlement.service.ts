import { createHash } from "node:crypto";
import type { MutationOutcome } from "@nervekit/contracts/conversations";
import type {
  CanonicalExecutionAttempt,
  CanonicalLifecycleWork,
  ExecutionClaim,
  LogicalEffect,
  ProviderPhase,
  WaitGroup,
} from "@nervekit/contracts/runs";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import type { CanonicalToolDispatchSnapshot } from "./canonical-tool-dispatch.service.js";
import { canonicalConversationJson } from "./command-fingerprint.js";
import { CanonicalRunTimelineService } from "./canonical-run-timeline.service.js";

export type CanonicalToolSettlementResult =
  | {
      kind: "committed" | "receipt_replay";
      resultEntryId: string;
      continuationScheduled: boolean;
    }
  | { kind: "rejected"; outcome: MutationOutcome };

/** Attaches one verified tool result and advances its barrier exactly once. */
export class CanonicalToolSettlementService {
  private readonly timeline: CanonicalRunTimelineService;

  constructor(private readonly store: CanonicalStore) {
    this.timeline = new CanonicalRunTimelineService(store);
  }

  async commitResult(input: {
    snapshot: CanonicalToolDispatchSnapshot;
    workerId: string;
    resultEntryId: string;
    result: unknown;
    failed: boolean;
    now: string;
    providerIdentity: Record<string, unknown>;
    providerCapability:
      | "stateless_generation"
      | "contractually_replay_safe"
      | "non_repeatable_or_unknown";
  }): Promise<CanonicalToolSettlementResult> {
    const snapshot = input.snapshot;
    const [head, run, effect, attempt, claim, work, group] = await Promise.all([
      this.store.readTimelineConversationHead(snapshot.conversationId),
      this.store.readTimelineRunControl(
        snapshot.conversationId,
        snapshot.runId,
      ),
      this.store.execution.readEffect(snapshot.effect.effectId),
      this.store.execution.readAttempt(snapshot.attempt.attemptId),
      this.store.execution.readClaim(snapshot.claim.claimId),
      this.store.execution.readLifecycleWork(snapshot.work.workId),
      this.store.execution.readWaitGroup(snapshot.waitGroup.waitGroupId),
    ]);
    const anchorStillApplies = head?.activeEntryId
      ? await this.store.timelineEntryIsAncestor(
          snapshot.conversationId,
          snapshot.continuationEntryId,
          head.activeEntryId,
        )
      : false;
    const member = group?.members.find(
      (candidate) => candidate.memberId === snapshot.effect.memberId,
    );
    if (
      !head ||
      !run ||
      !effect ||
      !attempt ||
      !claim ||
      !work ||
      !group ||
      !member ||
      !anchorStillApplies ||
      effect.state !== "dispatching" ||
      attempt.state !== "dispatched" ||
      claim.state !== "active" ||
      claim.token !== snapshot.claim.token ||
      Date.parse(claim.leaseDeadline) <= Date.parse(input.now) ||
      work.state !== "leased" ||
      work.leaseOwner !== input.workerId ||
      Date.parse(work.leaseDeadline ?? "") <= Date.parse(input.now) ||
      member.executionState !== "executing" ||
      member.attachmentDisposition !== "pending" ||
      run.generation !== snapshot.runGeneration ||
      run.boundSelectionEpoch !== snapshot.selectionEpoch ||
      head.selectionEpoch !== snapshot.selectionEpoch ||
      head.foregroundRunId !== snapshot.runId ||
      !run.foregroundOwned
    ) {
      return rejected("tool_settlement_fence_changed");
    }
    const resultData = {
      schemaVersion: 1,
      effectId: effect.effectId,
      attemptId: attempt.attemptId,
      inputFingerprint: effect.normalizedInputFingerprint,
      result: input.result,
      failed: input.failed,
    };
    const digest = createHash("sha256")
      .update(canonicalConversationJson(resultData))
      .digest("hex");
    const manifestId = `manifest_tool_result_${effect.effectId.slice("effect_".length)}`;
    const settledEffect: LogicalEffect = { ...effect, state: "settled" };
    const settledAttempt: CanonicalExecutionAttempt = {
      ...attempt,
      state: input.failed ? "known_failed" : "succeeded",
      outcome: { failed: input.failed, digest: `sha256:${digest}` },
      preparedManifestId: manifestId,
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
    const settledMembers = group.members.map((candidate) =>
      candidate.memberId === member.memberId
        ? {
            ...candidate,
            executionState: input.failed
              ? ("known_failed" as const)
              : ("succeeded" as const),
            attachmentDisposition: "attached" as const,
            resultEntryId: input.resultEntryId,
            contributesToBarrier: true,
            revision: candidate.revision + 1,
          }
        : candidate,
    );
    const allSettled = settledMembers.every(
      (candidate) => candidate.contributesToBarrier,
    );
    const nextGroup: WaitGroup = {
      ...group,
      members: settledMembers,
      continuationConsumed: allSettled,
      state: allSettled ? "closed" : "open",
      revision: group.revision + 1,
    };
    const phaseSuffix = `${snapshot.runId.slice("run_".length)}_${run.generation}_${run.revision + 1}`;
    const nextPhase: ProviderPhase | undefined = allSettled
      ? {
          schemaVersion: 1,
          phaseId: `provider_phase_${phaseSuffix}`,
          runId: snapshot.runId,
          runGeneration: run.generation,
          selectionEpoch: head.selectionEpoch,
          sourceEntryId: input.resultEntryId,
          contextRecipeId: `context_recipe_${phaseSuffix}`,
          providerIdentity: input.providerIdentity,
          capability: input.providerCapability,
          state: "preparing",
        }
      : undefined;
    const preparationWork: CanonicalLifecycleWork | undefined = nextPhase
      ? {
          schemaVersion: 1,
          workId: `canonical_work_${phaseSuffix}_provider`,
          conversationId: snapshot.conversationId,
          runId: snapshot.runId,
          kind: "prepare_provider_request",
          providerPhaseId: nextPhase.phaseId,
          state: "ready",
          inputHash: `sha256:${createHash("sha256")
            .update(`${nextPhase.phaseId}:${input.resultEntryId}`)
            .digest("hex")}`,
          generation: 0,
          revision: 1,
          notBefore: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        }
      : undefined;
    const result = await this.timeline.append({
      conversationId: snapshot.conversationId,
      runId: snapshot.runId,
      commandId: `settle-tool-result:${attempt.attemptId}`,
      now: input.now,
      actor: { kind: "worker", workerId: input.workerId },
      cause: {
        kind: "tool_result_settled",
        effectId: effect.effectId,
        attemptId: attempt.attemptId,
      },
      entries: [
        {
          entryId: input.resultEntryId,
          kind: "tool_result",
          inlineContent: {
            exactHarnessMessage: input.result,
            failed: input.failed,
          },
          toolCallId: member.ownerId,
          provenance: {
            effectId: effect.effectId,
            attemptId: attempt.attemptId,
            agentId: effect.owner.agentId,
          },
        },
      ],
      artifactManifests: [{ manifestId, schemaVersion: 1, data: resultData }],
      waitGroups: [nextGroup],
      logicalEffects: [settledEffect],
      executionAttempts: [settledAttempt],
      executionClaims: [consumedClaim],
      providerPhases: nextPhase ? [nextPhase] : [],
      lifecycleWorks: [
        settledWork,
        ...(preparationWork ? [preparationWork] : []),
      ],
      providerPhaseId: nextPhase?.phaseId ?? null,
      waitGroupId: allSettled ? null : group.waitGroupId,
      runState: allSettled ? "running" : "partially_waiting",
    });
    return result.kind === "rejected"
      ? result
      : {
          kind: result.kind,
          resultEntryId: input.resultEntryId,
          continuationScheduled: allSettled,
        };
  }
}

function rejected(reason: string): CanonicalToolSettlementResult {
  return { kind: "rejected", outcome: { kind: "superseded", reason } };
}
