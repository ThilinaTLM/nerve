import type { ConversationDeletionCursor } from "./conversation-deletion.js";
import type { ConversationJournalCommit } from "@nervekit/contracts/conversations";
import type { LifecycleWork, RecoveryIssue } from "@nervekit/contracts/runs";
import type { TimelineAuthorityPromotion } from "@nervekit/contracts/storage";
import type {
  ClaimLifecycleWorkInput,
  LifecycleAtomicCommitInput,
  ReconciliationOperationRecord,
  RequeueLifecycleWorkInput,
  RenewLifecycleWorkInput,
  SettleLifecycleWorkInput,
} from "./lifecycle-work-database.js";
import type { CommitConversationCommandInput } from "./timeline-database.js";
import type {
  ConversationPersistenceDelta,
  SerializedConversationState,
} from "../../../domains/conversations/conversation-state-materializer.js";

export type CanonicalCommand =
  | { kind: "initialize" }
  | { kind: "read_legacy_lifecycle_authority_facts" }
  | { kind: "retire_legacy_runtime_authority" }
  | { kind: "count_legacy_runtime_authority" }
  | { kind: "create_timeline_backup_snapshot"; destination: string }
  | { kind: "count_compaction_provider_phases"; runId: string }
  | {
      kind: "claim_ready_canonical_lifecycle_work";
      workerId: string;
      now: string;
      leaseDurationMs: number;
      workId?: string;
    }
  | {
      kind: "read_canonical_run_execution_authority";
      runId: string;
      phaseId?: string;
    }
  | { kind: "read_canonical_wait_group"; waitGroupId: string }
  | { kind: "read_canonical_authorization"; authorizationId: string }
  | { kind: "read_canonical_logical_effect"; effectId: string }
  | { kind: "read_canonical_execution_attempt"; attemptId: string }
  | { kind: "read_canonical_execution_claim"; claimId: string }
  | { kind: "read_canonical_provider_phase"; phaseId: string }
  | { kind: "read_canonical_lifecycle_work"; workId: string }
  | { kind: "list_ready_canonical_lifecycle_work"; now: string; limit: number }
  | { kind: "list_pending_canonical_deletions"; limit: number }
  | { kind: "read_canonical_deletion_intent"; conversationId: string }
  | { kind: "read_canonical_deletion_tombstone"; conversationId: string }
  | {
      kind: "settle_canonical_deletion_execution";
      conversationId: string;
      now: string;
    }
  | {
      kind: "claim_canonical_artifact_deletion";
      conversationId: string;
      limit: number;
      now: string;
    }
  | {
      kind: "settle_canonical_artifact_deletion";
      workId: string;
      state: "deleted" | "missing" | "failed";
      error?: string;
      now: string;
    }
  | {
      kind: "remove_canonical_deletion_history";
      conversationId: string;
      limit: number;
      now: string;
    }
  | {
      kind: "redact_canonical_deletion_payloads";
      conversationId: string;
      limit: number;
      now: string;
    }
  | {
      kind: "commit_conversation_command";
      input: CommitConversationCommandInput;
    }
  | {
      kind: "read_timeline_command_receipt";
      input: {
        namespaceId: string;
        operationKind: string;
        ownerKind: "state" | "conversation" | "policy_scope";
        ownerId: string;
        commandId: string;
        fingerprint: string;
      };
    }
  | { kind: "read_timeline_state_identity" }
  | { kind: "read_timeline_runtime_admission" }
  | { kind: "disable_timeline_runtime_admission"; now: string }
  | {
      kind: "promote_timeline_runtime_admission";
      promotion: TimelineAuthorityPromotion;
    }
  | { kind: "read_timeline_conversation_head"; conversationId: string }
  | { kind: "read_timeline_deletion_state"; conversationId: string }
  | {
      kind: "record_timeline_transcript_projection_failure";
      conversationId: string;
      message: string;
      now: string;
    }
  | {
      kind: "rebuild_timeline_transcript_projection";
      conversationId: string;
      now: string;
      invalidateCursors: boolean;
    }
  | {
      kind: "read_timeline_search_projection_page";
      conversationId: string;
      sourceRevision: number;
      matchExpression: string;
      afterDepth?: number;
      afterEntryId?: string;
      limit: number;
    }
  | {
      kind: "read_timeline_transcript_projection_page";
      conversationId: string;
      sourceRevision: number;
      beforeDepth?: number;
      limit: number;
    }
  | {
      kind: "read_pending_timeline_transcript_projections";
      limit: number;
    }
  | {
      kind: "read_timeline_transcript_projection_status";
      conversationId: string;
    }
  | {
      kind: "read_timeline_head_at_revision";
      conversationId: string;
      revision: number;
    }
  | {
      kind: "read_timeline_run_control";
      conversationId: string;
      runId: string;
    }
  | {
      kind: "read_timeline_fixed_tree_page";
      conversationId: string;
      sourceRevision: number;
      after?: { revision: number; ordinal: number; entryId: string };
      limit: number;
    }
  | {
      kind: "read_timeline_fixed_ancestry_page";
      conversationId: string;
      sourceEntryId: string;
      beforeDepth?: number;
      limit: number;
    }
  | {
      kind: "read_timeline_ancestry_segment";
      conversationId: string;
      sourceEntryId: string;
      limit: number;
    }
  | {
      kind: "timeline_entry_is_ancestor";
      conversationId: string;
      ancestorEntryId: string | null;
      descendantEntryId: string | null;
    }
  | {
      kind: "persist_lifecycle_atomic_commit";
      input: LifecycleAtomicCommitInput;
    }
  | { kind: "insert_lifecycle_work"; work: LifecycleWork }
  | { kind: "read_lifecycle_work"; workId: string }
  | { kind: "list_due_lifecycle_work"; now: string; limit: number }
  | { kind: "list_expired_lifecycle_work"; now: string; limit: number }
  | { kind: "claim_lifecycle_work"; input: ClaimLifecycleWorkInput }
  | { kind: "renew_lifecycle_work"; input: RenewLifecycleWorkInput }
  | { kind: "requeue_lifecycle_work"; input: RequeueLifecycleWorkInput }
  | { kind: "settle_lifecycle_work"; input: SettleLifecycleWorkInput }
  | { kind: "persist_recovery_issue"; issue: RecoveryIssue }
  | { kind: "list_recovery_issues"; conversationId: string }
  | { kind: "resolve_recovery_issues_for_run"; runId: string; now: string }
  | {
      kind: "read_lifecycle_command_receipt";
      scopeId: string;
      requestId: string;
    }
  | {
      kind: "read_reconciliation_operation";
      conversationId: string;
      requestId: string;
    }
  | {
      kind: "begin_reconciliation_operation";
      operation: ReconciliationOperationRecord;
    }
  | {
      kind: "settle_reconciliation_operation";
      operation: ReconciliationOperationRecord;
    }
  | { kind: "read_rpc_idempotency"; scope: string; key: string; now: number }
  | {
      kind: "write_rpc_idempotency";
      entry: {
        scope: string;
        key: string;
        method: string;
        paramsHash: string;
        outcome: unknown;
        expiresAt: number;
        createdAt: number;
      };
      maxEntries: number;
      now: number;
    }
  | {
      kind: "read_document";
      namespace: string;
      scopeId: string;
      documentId: string;
    }
  | { kind: "list_documents"; namespace: string; scopeId?: string }
  | { kind: "list_document_keys"; namespace: string; scopeId?: string }
  | {
      kind: "write_document";
      input: {
        namespace: string;
        scopeId: string;
        documentId: string;
        data: unknown;
        payloadVersion?: number;
        expectedRevision?: number;
        now?: string;
      };
    }
  | {
      kind: "delete_document";
      namespace: string;
      scopeId: string;
      documentId: string;
      expectedRevision?: number;
    }
  | {
      kind: "append_durable_event";
      input: {
        stream: string;
        intentId: string;
        eventType: string;
        data: unknown;
        occurredAt: string;
        conversationId?: string;
      };
    }
  | { kind: "durable_event_for_intent"; intentId: string }
  | {
      kind: "read_durable_events";
      stream: string;
      fromSequence: number;
      limit: number;
    }
  | { kind: "durable_event_bounds"; stream: string }
  | { kind: "remove_durable_event_stream"; stream: string }
  | {
      kind: "persist_conversation_state";
      state: SerializedConversationState;
      commit?: ConversationJournalCommit;
    }
  | {
      kind: "persist_conversation_commit";
      delta: ConversationPersistenceDelta;
    }
  | { kind: "read_conversation_revision"; conversationId: string }
  | { kind: "read_conversation_entries"; conversationId: string }
  | {
      kind: "scan_tool_calls";
      afterId?: string;
      maxRows: number;
      maxBytes: number;
    }
  | { kind: "read_tool_call"; toolCallId: string }
  | { kind: "count_tool_call_projections" }
  | {
      kind: "query_tool_call_projections";
      query: {
        status?: string;
        pendingInteractionKind?: string;
        conversationId?: string;
        projectId?: string;
        agentId?: string;
        runId?: string;
        limit?: number;
        cursor?: { updatedAt: string; id: string };
      };
    }
  | { kind: "list_tool_call_startup_records" }
  | { kind: "tool_call_conversation_id"; toolCallId: string }
  | { kind: "list_run_metadata" }
  | { kind: "list_run_states"; statuses: string[] }
  | { kind: "list_run_delivery_recovery_states" }
  | { kind: "read_run_state"; runId: string }
  | {
      kind: "backfill_conversation_record_projections";
      afterId?: string;
      maxRows: number;
    }
  | { kind: "list_conversation_journal_ids" }
  | { kind: "read_conversation_journal"; conversationId: string }
  | {
      kind: "checkpoint_conversation_state";
      input: {
        conversationId: string;
        revision: number;
        checksum?: string;
        data: Uint8Array;
      };
    }
  | {
      kind: "delete_conversation_state_chunk";
      conversationId: string;
      limit: number;
      cursor?: ConversationDeletionCursor;
    }
  | { kind: "integrity_check" }
  | { kind: "checkpoint" }
  | { kind: "close" };

export interface CanonicalPendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export interface CanonicalWorkerRequest {
  id: number;
  command: CanonicalCommand;
}

export type CanonicalWorkerResponse =
  | { id: number; ok: true; value: unknown }
  | {
      id: number;
      ok: false;
      error: { name: string; message: string; stack?: string };
    };

export const READ_COMMANDS = new Set<CanonicalCommand["kind"]>([
  "count_compaction_provider_phases",
  "read_canonical_run_execution_authority",
  "read_canonical_wait_group",
  "read_canonical_authorization",
  "read_canonical_logical_effect",
  "read_canonical_execution_attempt",
  "read_canonical_execution_claim",
  "read_canonical_provider_phase",
  "read_canonical_lifecycle_work",
  "list_ready_canonical_lifecycle_work",
  "list_pending_canonical_deletions",
  "read_canonical_deletion_intent",
  "read_canonical_deletion_tombstone",
  "read_timeline_command_receipt",
  "read_timeline_state_identity",
  "read_timeline_runtime_admission",
  "read_timeline_conversation_head",
  "read_timeline_deletion_state",
  "read_pending_timeline_transcript_projections",
  "read_timeline_search_projection_page",
  "read_timeline_transcript_projection_page",
  "read_timeline_transcript_projection_status",
  "read_timeline_head_at_revision",
  "read_timeline_run_control",
  "read_timeline_fixed_tree_page",
  "read_timeline_fixed_ancestry_page",
  "read_timeline_ancestry_segment",
  "timeline_entry_is_ancestor",
  "read_lifecycle_work",
  "list_due_lifecycle_work",
  "list_expired_lifecycle_work",
  "read_reconciliation_operation",
  "read_lifecycle_command_receipt",
  "read_document",
  "list_documents",
  "read_conversation_revision",
  "read_conversation_entries",
  "scan_tool_calls",
  "read_tool_call",
  "count_tool_call_projections",
  "query_tool_call_projections",
  "list_tool_call_startup_records",
  "tool_call_conversation_id",
  "list_run_metadata",
  "list_run_states",
  "list_run_delivery_recovery_states",
  "read_run_state",
  "list_conversation_journal_ids",
  "read_conversation_journal",
  "durable_event_for_intent",
  "read_durable_events",
  "durable_event_bounds",
]);
