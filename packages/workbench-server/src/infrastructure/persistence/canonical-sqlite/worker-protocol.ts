import type { ConversationJournalCommit } from "@nervekit/contracts/conversations";
import type {
  ConversationPersistenceDelta,
  SerializedConversationState,
} from "../../../domains/conversations/conversation-state-materializer.js";

export type CanonicalCommand =
  | { kind: "initialize" }
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
  | { kind: "delete_conversation_state"; conversationId: string }
  | { kind: "integrity_check" }
  | { kind: "checkpoint" }
  | { kind: "close" };

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
