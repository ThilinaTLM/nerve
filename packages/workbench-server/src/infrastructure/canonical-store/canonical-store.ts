import { Worker } from "node:worker_threads";
import type { PermissionRule } from "@nervekit/contracts";
import type { CanonicalDocument } from "./canonical-database.js";
import type {
  CanonicalCommand,
  CanonicalWorkerResponse,
} from "./worker-protocol.js";
import { READ_COMMANDS } from "./worker-protocol.js";

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

class WorkerEndpoint {
  private nextId = 1;
  private closed = false;
  private readonly pending = new Map<number, PendingRequest>();

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
    // The daemon's runtime workers are durable infrastructure and must keep the
    // process alive. Test-created repositories may intentionally rely on
    // process teardown instead of owning the application's shutdown lifecycle.
    if (process.env.NODE_TEST_CONTEXT) worker.unref();
  }

  request<T>(command: CanonicalCommand): Promise<T> {
    if (this.closed)
      return Promise.reject(new Error("Canonical store is closed."));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.worker.postMessage({ id, command });
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
  ): Promise<T> {
    if (!this.writer)
      return Promise.reject(new Error("Canonical store is not initialized."));
    if (
      !consistent &&
      READ_COMMANDS.has(command.kind) &&
      this.readers.length > 0
    ) {
      const reader = this.readers[this.nextReader++ % this.readers.length];
      return reader!.request<T>(command);
    }
    return this.writer.request<T>(command);
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
  listPermissionRules(projectId?: string) {
    return this.request<PermissionRule[]>({
      kind: "list_permission_rules",
      projectId,
    });
  }
  replacePermissionRules(
    scope: "user" | "project",
    projectId: string | undefined,
    rules: PermissionRule[],
  ) {
    return this.request<void>(
      { kind: "replace_permission_rules", scope, projectId, rules },
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
  persistConversationState(
    state: import("../../domains/conversations/conversation-state-materializer.js").SerializedConversationState,
    commit?: import("@nervekit/contracts").ConversationJournalCommit,
  ) {
    return this.request<void>(
      { kind: "persist_conversation_state", state, commit },
      true,
    );
  }
  persistConversationCommit(
    delta: import("../../domains/conversations/conversation-state-materializer.js").ConversationPersistenceDelta,
  ) {
    return this.request<void>(
      { kind: "persist_conversation_commit", delta },
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
      snapshot?: import("../../domains/conversations/conversation-state-materializer.js").SerializedConversationState;
      commits: unknown[];
      head?: { revision: number; checksum?: string };
    }>({ kind: "read_conversation_journal", conversationId }, true);
  }
  checkpointConversationState(
    state: import("../../domains/conversations/conversation-state-materializer.js").SerializedConversationState,
  ) {
    return this.request<void>(
      { kind: "checkpoint_conversation_state", state },
      true,
    );
  }
  deleteConversationState(conversationId: string) {
    return this.request<void>(
      { kind: "delete_conversation_state", conversationId },
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
