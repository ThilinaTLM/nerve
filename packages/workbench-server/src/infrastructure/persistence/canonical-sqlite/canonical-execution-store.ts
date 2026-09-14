import type {
  CanonicalExecutionAttempt,
  CanonicalLifecycleWork,
  ExactCallAuthorization,
  ExecutionClaim,
  LogicalEffect,
  ProviderPhase,
  WaitGroup,
} from "@nervekit/contracts/runs";
import type { CanonicalRunExecutionAuthority } from "./timeline-execution-database.js";
import type { CanonicalCommand } from "./worker-protocol.js";

export class CanonicalExecutionStore {
  constructor(
    private readonly request: <T>(command: CanonicalCommand) => Promise<T>,
  ) {}

  recoverExpiredLifecycleWork(input: { now: string; limit: number }) {
    return this.request<CanonicalLifecycleWork[]>({
      kind: "recover_expired_canonical_lifecycle_work",
      ...input,
    });
  }

  claimReadyLifecycleWork(input: {
    workerId: string;
    now: string;
    leaseDurationMs: number;
    workId?: string;
  }) {
    return this.request<CanonicalLifecycleWork | undefined>({
      kind: "claim_ready_canonical_lifecycle_work",
      ...input,
    });
  }

  readRunExecutionAuthority(runId: string, phaseId?: string) {
    return this.request<CanonicalRunExecutionAuthority>({
      kind: "read_canonical_run_execution_authority",
      runId,
      phaseId,
    });
  }

  readArtifactManifest(manifestId: string) {
    return this.request<unknown | undefined>({
      kind: "read_canonical_artifact_manifest",
      manifestId,
    });
  }

  listRecoveryWork(conversationId?: string, limit = 1_000) {
    return this.request<CanonicalLifecycleWork[]>({
      kind: "list_canonical_recovery_work",
      conversationId,
      limit,
    });
  }

  listPendingWaitGroups(limit = 100) {
    return this.request<WaitGroup[]>({
      kind: "list_canonical_pending_wait_groups",
      limit,
    });
  }

  findWaitGroupByMemberOwner(ownerId: string) {
    return this.request<WaitGroup | undefined>({
      kind: "find_canonical_wait_group_by_member_owner",
      ownerId,
    });
  }

  readWaitGroup(waitGroupId: string) {
    return this.request<WaitGroup | undefined>({
      kind: "read_canonical_wait_group",
      waitGroupId,
    });
  }

  readAuthorization(authorizationId: string) {
    return this.request<ExactCallAuthorization | undefined>({
      kind: "read_canonical_authorization",
      authorizationId,
    });
  }

  readEffect(effectId: string) {
    return this.request<LogicalEffect | undefined>({
      kind: "read_canonical_logical_effect",
      effectId,
    });
  }

  readAttempt(attemptId: string) {
    return this.request<CanonicalExecutionAttempt | undefined>({
      kind: "read_canonical_execution_attempt",
      attemptId,
    });
  }

  readClaim(claimId: string) {
    return this.request<ExecutionClaim | undefined>({
      kind: "read_canonical_execution_claim",
      claimId,
    });
  }

  readProviderPhase(phaseId: string) {
    return this.request<ProviderPhase | undefined>({
      kind: "read_canonical_provider_phase",
      phaseId,
    });
  }

  readLifecycleWork(workId: string) {
    return this.request<CanonicalLifecycleWork | undefined>({
      kind: "read_canonical_lifecycle_work",
      workId,
    });
  }

  listReadyLifecycleWork(now: string, limit: number) {
    return this.request<CanonicalLifecycleWork[]>({
      kind: "list_ready_canonical_lifecycle_work",
      now,
      limit,
    });
  }
}
