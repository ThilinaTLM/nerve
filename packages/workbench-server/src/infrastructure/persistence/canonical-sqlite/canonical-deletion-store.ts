import type {
  ArtifactDeletionWork,
  DeletionIntent,
  OwnerTombstone,
} from "@nervekit/contracts/storage";
import type { CanonicalCommand } from "./worker-protocol.js";

type Request = <T>(command: CanonicalCommand) => Promise<T>;

/** Narrow persistence facade for restart-safe canonical deletion cleanup. */
export class CanonicalDeletionStore {
  constructor(private readonly request: Request) {}

  listPending(limit: number) {
    return this.request<string[]>({
      kind: "list_pending_canonical_deletions",
      limit,
    });
  }

  readIntent(conversationId: string) {
    return this.request<DeletionIntent | undefined>({
      kind: "read_canonical_deletion_intent",
      conversationId,
    });
  }

  readTombstone(conversationId: string) {
    return this.request<OwnerTombstone | undefined>({
      kind: "read_canonical_deletion_tombstone",
      conversationId,
    });
  }

  settleExecution(conversationId: string, now: string) {
    return this.request<DeletionIntent>({
      kind: "settle_canonical_deletion_execution",
      conversationId,
      now,
    });
  }

  claimArtifacts(conversationId: string, limit: number, now: string) {
    return this.request<ArtifactDeletionWork[]>({
      kind: "claim_canonical_artifact_deletion",
      conversationId,
      limit,
      now,
    });
  }

  settleArtifact(
    workId: string,
    state: "deleted" | "missing" | "failed",
    error: string | undefined,
    now: string,
  ) {
    return this.request<void>({
      kind: "settle_canonical_artifact_deletion",
      workId,
      state,
      ...(error === undefined ? {} : { error }),
      now,
    });
  }

  removeHistory(conversationId: string, limit: number, now: string) {
    return this.request<DeletionIntent>({
      kind: "remove_canonical_deletion_history",
      conversationId,
      limit,
      now,
    });
  }

  redactPayloads(conversationId: string, limit: number, now: string) {
    return this.request<DeletionIntent>({
      kind: "redact_canonical_deletion_payloads",
      conversationId,
      limit,
      now,
    });
  }
}
