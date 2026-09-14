import type { MutationOutcome } from "@nervekit/contracts/conversations";
import type { CanonicalLifecycleWork } from "@nervekit/contracts/runs";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import {
  CanonicalProviderDispatchService,
  type CanonicalProviderDispatchSnapshot,
} from "./canonical-provider-dispatch.service.js";
import { CanonicalProviderPreparationService } from "./canonical-provider-preparation.service.js";

export type CanonicalProviderInvocationResult =
  | { kind: "ready"; snapshot: CanonicalProviderDispatchSnapshot }
  | { kind: "rejected"; outcome: MutationOutcome };

/** Advances one claimed preparation obligation to fenced dispatch authority. */
export class CanonicalProviderInvocationService {
  private readonly preparation: CanonicalProviderPreparationService;
  private readonly dispatch: CanonicalProviderDispatchService;

  constructor(private readonly store: CanonicalStore) {
    this.preparation = new CanonicalProviderPreparationService(store);
    this.dispatch = new CanonicalProviderDispatchService(store);
  }

  async prepareForDispatch(input: {
    preparationWork: CanonicalLifecycleWork;
    workerId: string;
    request: unknown;
    now: string;
    schedulerLeaseDurationMs?: number;
    executionClaimDurationMs?: number;
  }): Promise<CanonicalProviderInvocationResult> {
    const initial = input.preparationWork;
    if (
      initial.kind !== "prepare_provider_request" ||
      initial.state !== "leased" ||
      initial.leaseOwner !== input.workerId ||
      !initial.providerPhaseId
    ) {
      return rejected("provider_preparation_work_invalid");
    }
    const prepared = await this.preparation.commitPreparedRequest({
      workId: initial.workId,
      workerId: input.workerId,
      conversationId: initial.conversationId,
      runId: initial.runId,
      phaseId: initial.providerPhaseId,
      request: input.request,
      now: input.now,
    });
    if (prepared.kind === "rejected") return prepared;
    const claimWork = await this.store.execution.claimReadyLifecycleWork({
      workId: prepared.work.workId,
      workerId: input.workerId,
      now: input.now,
      leaseDurationMs: input.schedulerLeaseDurationMs ?? 30_000,
    });
    if (!claimWork) return rejected("provider_claim_work_unavailable");
    const authorized = await this.dispatch.authorizeFirstAttempt({
      workId: claimWork.workId,
      workerId: input.workerId,
      conversationId: initial.conversationId,
      runId: initial.runId,
      phaseId: initial.providerPhaseId,
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
    if (!dispatchWork) return rejected("provider_dispatch_work_unavailable");
    const dispatched = await this.dispatch.markDispatched(
      { ...authorized.snapshot, work: dispatchWork },
      { workerId: input.workerId, now: input.now },
    );
    if (dispatched.kind === "rejected") return dispatched;
    return (await this.dispatch.revalidateBeforeDispatch(dispatched.snapshot, {
      workerId: input.workerId,
      now: input.now,
    }))
      ? { kind: "ready", snapshot: dispatched.snapshot }
      : rejected("provider_pre_dispatch_revalidation_failed");
  }
}

function rejected(reason: string): CanonicalProviderInvocationResult {
  return { kind: "rejected", outcome: { kind: "superseded", reason } };
}
