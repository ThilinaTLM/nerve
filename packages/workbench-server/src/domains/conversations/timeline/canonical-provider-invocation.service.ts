import { createHash } from "node:crypto";
import type { MutationOutcome } from "@nervekit/contracts/conversations";
import type { CanonicalLifecycleWork } from "@nervekit/contracts/runs";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import {
  CanonicalProviderDispatchService,
  type CanonicalProviderDispatchSnapshot,
} from "./canonical-provider-dispatch.service.js";
import { CanonicalProviderPreparationService } from "./canonical-provider-preparation.service.js";
import { canonicalConversationJson } from "./command-fingerprint.js";

export type CanonicalProviderInvocationResult =
  | { kind: "ready"; snapshot: CanonicalProviderDispatchSnapshot }
  | { kind: "rejected"; outcome: MutationOutcome };

interface ProviderInvocationInput {
  workerId: string;
  request: unknown;
  now: string;
  schedulerLeaseDurationMs?: number;
  executionClaimDurationMs?: number;
}

/** Advances one claimed provider obligation to fenced dispatch authority. */
export class CanonicalProviderInvocationService {
  private readonly preparation: CanonicalProviderPreparationService;
  private readonly dispatch: CanonicalProviderDispatchService;

  constructor(private readonly store: CanonicalStore) {
    this.preparation = new CanonicalProviderPreparationService(store);
    this.dispatch = new CanonicalProviderDispatchService(store);
  }

  async prepareForDispatch(
    input: ProviderInvocationInput & {
      preparationWork: CanonicalLifecycleWork;
    },
  ): Promise<CanonicalProviderInvocationResult> {
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
    return this.authorizeClaimWork({ ...input, claimWork });
  }

  async prepareReadyPhaseForDispatch(
    input: ProviderInvocationInput & { claimWork: CanonicalLifecycleWork },
  ): Promise<CanonicalProviderInvocationResult> {
    return this.authorizeClaimWork(input);
  }

  private async authorizeClaimWork(
    input: ProviderInvocationInput & { claimWork: CanonicalLifecycleWork },
  ): Promise<CanonicalProviderInvocationResult> {
    const work = input.claimWork;
    if (
      work.kind !== "claim_provider_attempt" ||
      work.state !== "leased" ||
      work.leaseOwner !== input.workerId ||
      !work.providerPhaseId
    ) {
      return rejected("provider_claim_work_invalid");
    }
    const phase = await this.store.execution.readProviderPhase(
      work.providerPhaseId,
    );
    const manifest = phase?.requestManifestId
      ? await this.store.execution.readArtifactManifest(phase.requestManifestId)
      : undefined;
    const record = manifest as { request?: unknown } | undefined;
    if (
      !phase ||
      phase.state !== "ready" ||
      phase.requestHash !== work.inputHash ||
      !manifest ||
      hash(manifest) !== phase.requestHash ||
      canonicalConversationJson(record?.request) !==
        canonicalConversationJson(input.request)
    ) {
      return rejected("provider_ready_request_mismatch");
    }
    const authorized = await this.dispatch.authorizeFirstAttempt({
      workId: work.workId,
      workerId: input.workerId,
      conversationId: work.conversationId,
      runId: work.runId,
      phaseId: work.providerPhaseId,
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

function hash(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(canonicalConversationJson(value))
    .digest("hex")}`;
}

function rejected(reason: string): CanonicalProviderInvocationResult {
  return { kind: "rejected", outcome: { kind: "superseded", reason } };
}
