import type { PermissionRule } from "@nervekit/contracts";
import type { ConversationJournalCommit } from "@nervekit/contracts";
import type { SerializedConversationState } from "../../domains/conversations/conversation-state-materializer.js";

export type CanonicalCommand =
  | { kind: "initialize" }
  | { kind: "read_settings" }
  | { kind: "write_settings"; data: unknown; expectedRevision?: number }
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
  | { kind: "list_permission_rules"; projectId?: string }
  | {
      kind: "replace_permission_rules";
      scope: "user" | "project";
      projectId?: string;
      rules: PermissionRule[];
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
  "read_settings",
  "read_document",
  "list_documents",
  "list_permission_rules",
  "durable_event_for_intent",
  "read_durable_events",
  "durable_event_bounds",
]);
