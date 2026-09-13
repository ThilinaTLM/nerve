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

export type CanonicalProviderSettlementResult =
  | { kind: "committed" | "receipt_replay"; responseId: string }
  | { kind: "rejected"; outcome: MutationOutcome };

/** Attaches one complete provider response and consumes its claim exactly once. */
export class CanonicalProviderSettlementService {
  private readonly timeline: CanonicalRunTimelineService;

  constructor(private readonly store: CanonicalStore) {
    this.timeline = new CanonicalRunTimelineService(store);
  }

  async commitResponse(input: {
    snapshot: CanonicalProviderDispatchSnapshot;
    workerId: string;
    response: unknown;
    entries: readonly AppendEntryDraft[];
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
      ],
      providerPhases: [preparedPhase, committedPhase],
      executionAttempts: [succeededAttempt],
      executionClaims: [consumedClaim],
      lifecycleWorks: [settledWork],
      providerPhaseId: null,
    });
    return result.kind === "rejected"
      ? result
      : { kind: result.kind, responseId };
  }
}

function rejected(reason: string): CanonicalProviderSettlementResult {
  return { kind: "rejected", outcome: { kind: "superseded", reason } };
}
