import type { LegacyLifecycleAuthorityFact } from "../../migrations/unified-timeline/legacy-authority-retirement-database.js";
import type { CanonicalCommand } from "./worker-protocol.js";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import type { RunRecord } from "@nervekit/contracts/runs";
import type { ToolCallRecord } from "@nervekit/contracts/tools";
import type {
  ConversationDeletionChunk,
  ConversationDeletionCursor,
  ConversationDeletionProgress,
} from "./conversation-deletion.js";
import { encode } from "./canonical-database.js";

export class CanonicalMigrationStore {
  constructor(
    private readonly request: <T>(
      command: CanonicalCommand,
      write?: boolean,
      transfer?: Transferable[],
    ) => Promise<T>,
  ) {}

  persistLifecycleAtomicCommit(
    input: import("../../migrations/legacy-lifecycle-work-database.js").LifecycleAtomicCommitInput,
  ) {
    return this.request<
      import("../../migrations/legacy-lifecycle-work-database.js").LifecycleAtomicCommitResult
    >({ kind: "persist_lifecycle_atomic_commit", input }, true);
  }

  countLegacyRuntimeAuthority() {
    return this.request<number>({ kind: "count_legacy_runtime_authority" });
  }

  readLegacyLifecycleAuthorityFacts() {
    return this.request<LegacyLifecycleAuthorityFact[]>({
      kind: "read_legacy_lifecycle_authority_facts",
    });
  }

  retireLegacyRuntimeAuthority() {
    return this.request<number>({ kind: "retire_legacy_runtime_authority" });
  }
  persistConversationState(
    state: import("../../migrations/legacy-journal/conversation-state-materializer.js").SerializedConversationState,
    commit?: import("@nervekit/contracts/conversations").ConversationJournalCommit,
  ) {
    return this.request<void>(
      { kind: "persist_conversation_state", state, commit },
      true,
    );
  }
  persistConversationCommit(
    delta: import("../../migrations/legacy-journal/conversation-state-materializer.js").ConversationPersistenceDelta,
  ) {
    return this.request<void>(
      { kind: "persist_conversation_commit", delta },
      true,
    );
  }
  async listConversationMetadata<T>() {
    return (
      await this.request<Array<{ data: T }>>({
        kind: "list_documents",
        namespace: "conversation",
      })
    ).map((document) => document.data);
  }
  readConversationRevision(conversationId: string) {
    return this.request<number>({
      kind: "read_conversation_revision",
      conversationId,
    });
  }
  readConversationEntries(conversationId: string) {
    return this.request<ConversationEntry[]>({
      kind: "read_conversation_entries",
      conversationId,
    });
  }
  scanToolCalls(input: {
    afterId?: string;
    maxRows?: number;
    maxBytes?: number;
  }) {
    return this.request<{
      records: ToolCallRecord[];
      nextCursor?: string;
      done: boolean;
      encodedBytes: number;
    }>({
      kind: "scan_tool_calls",
      ...(input.afterId ? { afterId: input.afterId } : {}),
      maxRows: input.maxRows ?? 128,
      maxBytes: input.maxBytes ?? 8 * 1024 * 1024,
    });
  }
  readToolCall(toolCallId: string): Promise<ToolCallRecord | undefined> {
    return this.request<ToolCallRecord | undefined>({
      kind: "read_tool_call",
      toolCallId,
    });
  }
  countToolCallProjections(): Promise<number> {
    return this.request<number>({ kind: "count_tool_call_projections" });
  }
  queryToolCallProjections(query: {
    status?: ToolCallRecord["status"];
    pendingInteractionKind?: "approval" | "user_input" | "plan_review";
    conversationId?: string;
    projectId?: string;
    agentId?: string;
    runId?: string;
    limit?: number;
    cursor?: { updatedAt: string; id: string };
  }) {
    return this.request<{
      records: ToolCallRecord[];
      nextCursor?: { updatedAt: string; id: string };
    }>({ kind: "query_tool_call_projections", query });
  }
  listToolCallStartupRecords(): Promise<ToolCallRecord[]> {
    return this.request<ToolCallRecord[]>({
      kind: "list_tool_call_startup_records",
    });
  }
  toolCallConversationId(toolCallId: string): Promise<string | undefined> {
    return this.request<string | undefined>({
      kind: "tool_call_conversation_id",
      toolCallId,
    });
  }
  listRunMetadata() {
    return this.request<RunRecord[]>({ kind: "list_run_metadata" });
  }
  listRunStates<T>(statuses: string[]) {
    return this.request<T[]>({ kind: "list_run_states", statuses });
  }
  listRunDeliveryRecoveryStates<T>() {
    return this.request<T[]>({ kind: "list_run_delivery_recovery_states" });
  }
  readRunState<T>(runId: string) {
    return this.request<T | undefined>({ kind: "read_run_state", runId });
  }
  backfillConversationRecordProjections(
    input: {
      afterId?: string;
      maxRows?: number;
    } = {},
  ) {
    return this.request<{
      inserted: number;
      nextCursor?: string;
      done: boolean;
    }>(
      {
        kind: "backfill_conversation_record_projections",
        ...(input.afterId ? { afterId: input.afterId } : {}),
        maxRows: input.maxRows ?? 250,
      },
      true,
    );
  }
  listConversationJournalIds() {
    return this.request<string[]>(
      { kind: "list_conversation_journal_ids" },
      true,
    );
  }
  readConversationJournal(conversationId: string) {
    return this.request<{
      snapshot?: Uint8Array;
      commits: Uint8Array[];
      head?: { revision: number; checksum?: string };
      encodedBytes: number;
    }>({ kind: "read_conversation_journal", conversationId }, true);
  }
  checkpointConversationState(
    state: import("../../migrations/legacy-journal/conversation-state-materializer.js").SerializedConversationState,
  ) {
    const data = Uint8Array.from(encode(state));
    return this.request<void>(
      {
        kind: "checkpoint_conversation_state",
        input: {
          conversationId: state.conversationId,
          revision: state.revision,
          ...(state.checksum ? { checksum: state.checksum } : {}),
          data,
        },
      },
      true,
      [data.buffer],
    );
  }
  async deleteConversationState(
    conversationId: string,
    onProgress?: (
      progress: ConversationDeletionProgress,
    ) => void | Promise<void>,
  ): Promise<void> {
    const limit = 500;
    let cursor: ConversationDeletionCursor = { phase: "events" };
    let removed = 0;
    let detached = 0;
    for (;;) {
      const result = await this.request<ConversationDeletionChunk>(
        {
          kind: "delete_conversation_state_chunk",
          conversationId,
          limit,
          cursor,
        },
        true,
      );
      cursor = result.next;
      removed += result.removed;
      detached += result.detached;
      await onProgress?.({ phase: result.phase, removed, detached });
      if (result.done) return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
}
