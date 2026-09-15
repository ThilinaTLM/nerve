import type { CommitConversationCommandInput } from "./timeline-database.js";
import {
  CanonicalExecutionStore,
  CanonicalMigrationStore,
  CanonicalPolicyStore,
} from "./store-facets.js";
import type {
  CanonicalAncestrySegment,
  CanonicalConversationEntry,
  ConversationHead,
  MutationOutcome,
  TimelineStateIdentity,
  TranscriptProjectionStatus,
} from "@nervekit/contracts/conversations";
import { Worker } from "node:worker_threads";
import type { RunControl } from "@nervekit/contracts/runs";
import type {
  RuntimeAdmission,
  TimelineAuthorityPromotion,
} from "@nervekit/contracts/storage";
import {
  type CanonicalDocument,
  type RpcIdempotencyEntry,
} from "./canonical-database.js";
import type {
  CanonicalCommand,
  CanonicalPendingRequest,
  CanonicalWorkerResponse,
} from "./worker-protocol.js";
import { READ_COMMANDS } from "./worker-protocol.js";
import type { BackupArtifactRecord } from "./timeline-backup-database.js";
import { CanonicalDeletionStore } from "./canonical-deletion-store.js";

class WorkerEndpoint {
  private nextId = 1;
  private closed = false;
  private readonly pending = new Map<number, CanonicalPendingRequest>();

  constructor(private readonly worker: Worker) {
    worker.on("message", (response: CanonicalWorkerResponse) => {
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.ok) pending.resolve(response.value);
      else {
        const error = new Error(response.error.message);
        error.name = response.error.name;
        if (response.error.stack) error.stack = response.error.stack;
        pending.reject(error);
      }
    });
    const fail = (error: Error) => {
      this.closed = true;
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
    worker.on("error", fail);
    worker.on("exit", (code) => {
      if (!this.closed && code !== 0)
        fail(new Error(`Canonical SQLite worker exited with code ${code}.`));
    });
    // Test workers may rely on process teardown; daemon workers remain durable.
    if (process.env.NODE_TEST_CONTEXT) worker.unref();
  }

  request<T>(
    command: CanonicalCommand,
    transferList: ArrayBuffer[] = [],
  ): Promise<T> {
    if (this.closed)
      return Promise.reject(new Error("Canonical store is closed."));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.worker.postMessage({ id, command }, transferList);
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    await this.request({ kind: "close" });
    this.closed = true;
    await this.worker.terminate();
  }
}

export class CanonicalStore {
  private writer?: WorkerEndpoint;
  private readers: WorkerEndpoint[] = [];
  private nextReader = 0;
  private readonly requester = <T>(command: CanonicalCommand) =>
    this.request<T>(command);
  readonly migration = new CanonicalMigrationStore(this.requester);
  readonly execution = new CanonicalExecutionStore(this.requester);
  readonly policy = new CanonicalPolicyStore(this.requester);
  readonly deletion = new CanonicalDeletionStore(this.requester);

  constructor(
    readonly path: string,
    private readonly options: { readerCount?: number } = {},
  ) {}

  async initialize(): Promise<void> {
    if (this.writer) return;
    this.writer = new WorkerEndpoint(
      new Worker(new URL("./writer-worker.js", import.meta.url), {
        workerData: { path: this.path },
      }),
    );
    await this.writer.request({ kind: "initialize" });
    const count = Math.max(
      0,
      this.options.readerCount ?? (process.env.NODE_TEST_CONTEXT ? 0 : 2),
    );
    this.readers = Array.from(
      { length: count },
      () =>
        new WorkerEndpoint(
          new Worker(new URL("./reader-worker.js", import.meta.url), {
            workerData: { path: this.path },
          }),
        ),
    );
  }

  private request<T>(
    command: CanonicalCommand,
    consistent = false,
    transferList: ArrayBuffer[] = [],
  ): Promise<T> {
    if (!this.writer)
      return Promise.reject(new Error("Canonical store is not initialized."));
    if (
      !consistent &&
      READ_COMMANDS.has(command.kind) &&
      this.readers.length > 0
    ) {
      const reader = this.readers[this.nextReader++ % this.readers.length];
      return reader!.request<T>(command, transferList);
    }
    return this.writer.request<T>(command, transferList);
  }

  commitConversationCommand(input: CommitConversationCommandInput) {
    return this.request<MutationOutcome>(
      { kind: "commit_conversation_command", input },
      true,
    );
  }

  readTimelineCommandReceipt(input: {
    namespaceId: string;
    operationKind: string;
    ownerKind: "state" | "conversation" | "policy_scope";
    ownerId: string;
    commandId: string;
    fingerprint: string;
  }) {
    return this.request<MutationOutcome | undefined>({
      kind: "read_timeline_command_receipt",
      input,
    });
  }

  readTimelineStateIdentity() {
    return this.request<TimelineStateIdentity | undefined>({
      kind: "read_timeline_state_identity",
    });
  }

  readTimelineRuntimeAdmission() {
    return this.request<RuntimeAdmission | undefined>({
      kind: "read_timeline_runtime_admission",
    });
  }
  disableTimelineRuntimeAdmission(now: string) {
    return this.request<RuntimeAdmission>({
      kind: "disable_timeline_runtime_admission",
      now,
    });
  }
  promoteTimelineRuntimeAdmission(promotion: TimelineAuthorityPromotion) {
    return this.request<TimelineAuthorityPromotion>({
      kind: "promote_timeline_runtime_admission",
      promotion,
    });
  }

  readTimelineConversationHead(conversationId: string) {
    return this.request<ConversationHead | undefined>({
      kind: "read_timeline_conversation_head",
      conversationId,
    });
  }

  createTimelineBackupSnapshot(destination: string) {
    return this.request<BackupArtifactRecord[]>({
      kind: "create_timeline_backup_snapshot",
      destination,
    });
  }

  recordTimelineTranscriptProjectionFailure(
    conversationId: string,
    message: string,
    now: string,
  ) {
    return this.request<void>({
      kind: "record_timeline_transcript_projection_failure",
      conversationId,
      message,
      now,
    });
  }

  rebuildTimelineTranscriptProjection(
    conversationId: string,
    now: string,
    invalidateCursors = true,
  ) {
    return this.request<TranscriptProjectionStatus | undefined>({
      kind: "rebuild_timeline_transcript_projection",
      conversationId,
      now,
      invalidateCursors,
    });
  }

  readPendingTimelineTranscriptProjections(limit: number) {
    return this.request<string[]>({
      kind: "read_pending_timeline_transcript_projections",
      limit,
    });
  }

  readTimelineSearchProjectionPage(input: {
    conversationId: string;
    sourceRevision: number;
    matchExpression: string;
    afterDepth?: number;
    afterEntryId?: string;
    limit: number;
  }) {
    return this.request<
      | {
          entries: CanonicalConversationEntry[];
          next?: { depth: number; entryId: string };
        }
      | undefined
    >({ kind: "read_timeline_search_projection_page", ...input });
  }

  readTimelineTranscriptProjectionPage(
    conversationId: string,
    sourceRevision: number,
    beforeDepth: number | undefined,
    limit: number,
  ) {
    return this.request<
      | {
          entries: CanonicalConversationEntry[];
          nextBeforeDepth?: number;
        }
      | undefined
    >({
      kind: "read_timeline_transcript_projection_page",
      conversationId,
      sourceRevision,
      ...(beforeDepth === undefined ? {} : { beforeDepth }),
      limit,
    });
  }

  readTimelineTranscriptProjectionStatus(conversationId: string) {
    return this.request<TranscriptProjectionStatus | undefined>({
      kind: "read_timeline_transcript_projection_status",
      conversationId,
    });
  }

  readTimelineDeletionState(conversationId: string) {
    return this.request<"active" | "pending" | "finalized" | undefined>({
      kind: "read_timeline_deletion_state",
      conversationId,
    });
  }

  readTimelineHeadAtRevision(conversationId: string, revision: number) {
    return this.request<ConversationHead | undefined>({
      kind: "read_timeline_head_at_revision",
      conversationId,
      revision,
    });
  }

  readTimelineRunControl(conversationId: string, runId: string) {
    return this.request<RunControl | undefined>({
      kind: "read_timeline_run_control",
      conversationId,
      runId,
    });
  }

  readTimelineFixedTreePage(
    conversationId: string,
    sourceRevision: number,
    after: { revision: number; ordinal: number; entryId: string } | undefined,
    limit: number,
  ) {
    return this.request<{
      entries: CanonicalConversationEntry[];
      nextAfter?: { revision: number; ordinal: number; entryId: string };
    }>({
      kind: "read_timeline_fixed_tree_page",
      conversationId,
      sourceRevision,
      ...(after ? { after } : {}),
      limit,
    });
  }

  readTimelineFixedAncestryPage(
    conversationId: string,
    sourceEntryId: string,
    beforeDepth: number | undefined,
    limit: number,
  ) {
    return this.request<{
      entries: CanonicalConversationEntry[];
      nextBeforeDepth?: number;
    }>({
      kind: "read_timeline_fixed_ancestry_page",
      conversationId,
      sourceEntryId,
      ...(beforeDepth === undefined ? {} : { beforeDepth }),
      limit,
    });
  }

  readTimelineAncestrySegment(
    conversationId: string,
    sourceEntryId: string,
    limit: number,
  ) {
    return this.request<CanonicalAncestrySegment>({
      kind: "read_timeline_ancestry_segment",
      conversationId,
      sourceEntryId,
      limit,
    });
  }

  timelineEntryIsAncestor(
    conversationId: string,
    ancestorEntryId: string | null,
    descendantEntryId: string | null,
  ) {
    return this.request<boolean>({
      kind: "timeline_entry_is_ancestor",
      conversationId,
      ancestorEntryId,
      descendantEntryId,
    });
  }

  readRpcIdempotency<T>(scope: string, key: string, now = Date.now()) {
    return this.request<RpcIdempotencyEntry<T> | undefined>(
      { kind: "read_rpc_idempotency", scope, key, now },
      true,
    );
  }
  writeRpcIdempotency<T>(
    entry: RpcIdempotencyEntry<T>,
    maxEntries: number,
    now = Date.now(),
  ) {
    return this.request<void>(
      { kind: "write_rpc_idempotency", entry, maxEntries, now },
      true,
    );
  }
  readDocument<T>(namespace: string, scopeId: string, documentId: string) {
    return this.request<CanonicalDocument<T> | undefined>(
      { kind: "read_document", namespace, scopeId, documentId },
      true,
    );
  }
  listDocuments<T>(namespace: string, scopeId?: string) {
    return this.request<CanonicalDocument<T>[]>({
      kind: "list_documents",
      namespace,
      scopeId,
    });
  }
  listDocumentKeys(namespace: string, scopeId?: string) {
    return this.request<Array<{ scopeId: string; documentId: string }>>({
      kind: "list_document_keys",
      namespace,
      scopeId,
    });
  }
  writeDocument<T>(input: {
    namespace: string;
    scopeId: string;
    documentId: string;
    data: T;
    payloadVersion?: number;
    expectedRevision?: number;
    now?: string;
  }) {
    return this.request<CanonicalDocument<T>>(
      { kind: "write_document", input },
      true,
    );
  }
  deleteDocument(
    namespace: string,
    scopeId: string,
    documentId: string,
    expectedRevision?: number,
  ) {
    return this.request<void>(
      {
        kind: "delete_document",
        namespace,
        scopeId,
        documentId,
        expectedRevision,
      },
      true,
    );
  }
  appendDurableEvent(input: {
    stream: string;
    intentId: string;
    eventType: string;
    data: unknown;
    occurredAt: string;
    conversationId?: string;
  }) {
    return this.request<{ sequence: number; intentId: string }>(
      { kind: "append_durable_event", input },
      true,
    );
  }
  durableEventForIntent(intentId: string) {
    return this.request<unknown>({
      kind: "durable_event_for_intent",
      intentId,
    });
  }
  readDurableEvents(stream: string, fromSequence: number, limit: number) {
    return this.request<
      Array<{
        sequence: number;
        stream: string;
        intentId: string;
        eventType: string;
        data: unknown;
        occurredAt: string;
      }>
    >({ kind: "read_durable_events", stream, fromSequence, limit });
  }
  durableEventBounds(stream: string) {
    return this.request<{
      stream: string;
      earliestAvailableSeq: number;
      latestSeq: number;
    }>({ kind: "durable_event_bounds", stream });
  }
  removeDurableEventStream(stream: string) {
    return this.request<void>(
      { kind: "remove_durable_event_stream", stream },
      true,
    );
  }
  integrityCheck() {
    return this.request<void>({ kind: "integrity_check" }, true);
  }
  async close(): Promise<void> {
    const readers = this.readers;
    this.readers = [];
    await Promise.all(readers.map((reader) => reader.close()));
    const writer = this.writer;
    this.writer = undefined;
    await writer?.close();
  }
}

export type { CanonicalDocument } from "./canonical-database.js";
export {
  CanonicalRevisionConflictError,
  decode,
  encode,
} from "./canonical-database.js";
