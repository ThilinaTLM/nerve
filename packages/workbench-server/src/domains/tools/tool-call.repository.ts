import { open, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  toolCallRecordSchema,
  type ToolCallRecord,
  type ToolCallTranscriptRecord,
} from "@nervekit/contracts";
import type {
  IndexStore,
  ToolCallPreviewQuery,
} from "../../infrastructure/index-store/index-store.js";
import {
  atomicWriteJson,
  type InitializedStorage,
} from "../../infrastructure/storage/index.js";
import { toToolCallTranscriptRecord } from "./tool-call-transcript-preview.js";

const TERMINAL_CACHE_MAX_BYTES = 16 * 1024 * 1024;

export interface ToolCallHydrationStats {
  rowCount: number;
  uniqueCount: number;
  fileBytes: number;
  activeCount: number;
  source: "files";
}

export class ToolCallRevisionConflictError extends Error {
  constructor(
    readonly toolCallId: string,
    readonly expected: number,
    readonly actual: number,
  ) {
    super(
      `Tool call '${toolCallId}' revision conflict: expected ${expected}, current ${actual}.`,
    );
    this.name = "ToolCallRevisionConflictError";
  }
}

/**
 * Canonical tool calls live in per-conversation JSON files. Only mutable calls
 * remain resident; immutable terminal details are loaded lazily into a
 * byte-bounded cache. SQLite contains disposable, bounded transcript previews.
 */
export class ToolCallRepository {
  readonly records: Map<string, ToolCallRecord> = new Map();
  private readonly terminalCache = new Map<
    string,
    { record: ToolCallRecord; bytes: number }
  >();
  private terminalCacheBytes = 0;
  private readonly mutations = new Map<string, Promise<void>>();
  private hydrationStats: ToolCallHydrationStats = {
    rowCount: 0,
    uniqueCount: 0,
    fileBytes: 0,
    activeCount: 0,
    source: "files",
  };

  constructor(
    private readonly storage: InitializedStorage,
    private readonly index: IndexStore,
  ) {}

  async hydrate(
    onRecord?: (record: ToolCallRecord) => void,
  ): Promise<ToolCallRecord[]> {
    this.records.clear();
    this.terminalCache.clear();
    this.terminalCacheBytes = 0;
    let fileBytes = 0;
    let rowCount = 0;
    const ids = new Set<string>();
    this.index.beginToolCallRebuild();
    try {
      const conversations = await readdir(
        join(this.storage.paths.home, "conversations"),
        { withFileTypes: true },
      ).catch(() => []);
      for (const conversation of conversations.sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (!conversation.isDirectory() || !validId(conversation.name, "conv_"))
          continue;
        const directory = join(
          this.storage.paths.home,
          "conversations",
          conversation.name,
          "tool-calls",
        );
        const files = await readdir(directory, { withFileTypes: true }).catch(
          () => [],
        );
        for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
          if (!file.isFile() || !file.name.endsWith(".json")) continue;
          const id = file.name.slice(0, -5);
          if (!validId(id, "tool_"))
            throw new Error(
              `Invalid canonical tool-call filename '${file.name}'.`,
            );
          const raw = await readFile(join(directory, file.name), "utf8");
          fileBytes += Buffer.byteLength(raw);
          const record = toolCallRecordSchema.parse(JSON.parse(raw));
          if (record.id !== id || record.conversationId !== conversation.name) {
            throw new Error(
              `Canonical tool-call path identity mismatch for '${id}'.`,
            );
          }
          if (ids.has(id))
            throw new Error(`Duplicate canonical tool call '${id}'.`);
          ids.add(id);
          rowCount += 1;
          this.index.appendToolCallRebuild(
            record,
            toToolCallTranscriptRecord(record),
          );
          if (!isTerminal(record.status)) this.records.set(id, record);
          onRecord?.(record);
        }
      }
      this.index.finishToolCallRebuild();
    } catch (error) {
      this.index.rollbackToolCallRebuild();
      throw error;
    }
    this.hydrationStats = {
      rowCount,
      uniqueCount: rowCount,
      fileBytes,
      activeCount: this.records.size,
      source: "files",
    };
    return this.listActive();
  }

  get hydrationSource(): "files" {
    return "files";
  }

  get hydrationStatsValue(): ToolCallHydrationStats {
    return { ...this.hydrationStats };
  }

  residentStats(): {
    activeRecords: number;
    cachedTerminalRecords: number;
    cachedTerminalBytes: number;
  } {
    return {
      activeRecords: this.records.size,
      cachedTerminalRecords: this.terminalCache.size,
      cachedTerminalBytes: this.terminalCacheBytes,
    };
  }

  count(): number {
    return this.index.countToolCalls();
  }

  listActive(): ToolCallRecord[] {
    return [...this.records.values()].sort(compareUpdatedDescending);
  }

  listPreviews(query: ToolCallPreviewQuery = {}): ToolCallTranscriptRecord[] {
    return this.index.listToolCallPreviews(query);
  }

  queryPreviews(query: ToolCallPreviewQuery = {}) {
    return this.index.queryToolCallPreviews(query);
  }

  get(toolCallId: string): ToolCallRecord {
    const active = this.records.get(toolCallId);
    if (active) return active;
    const cached = this.terminalCache.get(toolCallId);
    if (!cached)
      throw new Error("Tool call is not active; load it asynchronously.");
    this.terminalCache.delete(toolCallId);
    this.terminalCache.set(toolCallId, cached);
    return cached.record;
  }

  async getCanonical(toolCallId: string): Promise<ToolCallRecord> {
    const active = this.records.get(toolCallId);
    if (active) return active;
    const cached = this.terminalCache.get(toolCallId);
    if (cached) {
      this.terminalCache.delete(toolCallId);
      this.terminalCache.set(toolCallId, cached);
      return cached.record;
    }
    const conversationId = this.index.toolCallConversationId(toolCallId);
    if (!conversationId) throw new Error("Tool call not found.");
    const raw = await readFile(
      this.path({ id: toolCallId, conversationId }),
      "utf8",
    );
    const record = toolCallRecordSchema.parse(JSON.parse(raw));
    if (record.id !== toolCallId || record.conversationId !== conversationId)
      throw new Error("Canonical tool-call identity mismatch.");
    this.cacheTerminal(record, Buffer.byteLength(raw));
    return record;
  }

  findByProviderToolCallId(
    providerToolCallId: string | undefined,
  ): ToolCallRecord | undefined {
    if (!providerToolCallId) return undefined;
    return [
      ...this.records.values(),
      ...[...this.terminalCache.values()].map((cached) => cached.record),
    ].find(
      (toolCall) =>
        toolCall.providerToolCallId === providerToolCallId ||
        toolCall.sourceToolCallId === providerToolCallId,
    );
  }

  async create(toolCall: ToolCallRecord): Promise<ToolCallRecord> {
    const record = toolCallRecordSchema.parse({ ...toolCall, revision: 1 });
    return this.serialize(record.id, async () => {
      if (this.records.has(record.id))
        throw new Error(`Tool call '${record.id}' already exists.`);
      const path = this.path(record);
      await import("node:fs/promises").then(({ mkdir }) =>
        mkdir(dirname(path), { recursive: true, mode: 0o755 }),
      );
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (isTerminal(record.status)) {
        this.cacheTerminal(record, Buffer.byteLength(JSON.stringify(record)));
      } else {
        this.records.set(record.id, record);
      }
      this.index.upsertToolCall(record, toToolCallTranscriptRecord(record));
      return record;
    });
  }

  async replace(
    toolCallId: string,
    expectedRevision: number,
    mutate: (current: ToolCallRecord) => ToolCallRecord,
  ): Promise<ToolCallRecord> {
    return this.serialize(toolCallId, async () => {
      const current = this.get(toolCallId);
      if (current.revision !== expectedRevision) {
        throw new ToolCallRevisionConflictError(
          toolCallId,
          expectedRevision,
          current.revision,
        );
      }
      if (isTerminal(current.status))
        throw new Error(`Terminal tool call '${toolCallId}' is immutable.`);
      const candidate = mutate(current);
      assertImmutableIdentity(current, candidate);
      const next = toolCallRecordSchema.parse({
        ...candidate,
        revision: current.revision + 1,
      });
      await atomicWriteJson(this.path(next), next, 0o600);
      if (isTerminal(next.status)) {
        this.records.delete(next.id);
        this.cacheTerminal(next, Buffer.byteLength(JSON.stringify(next)));
      } else {
        this.records.set(next.id, next);
      }
      try {
        this.index.upsertToolCall(next, toToolCallTranscriptRecord(next));
      } catch {
        /* Canonical file remains authoritative. */
      }
      return next;
    });
  }

  async removeForConversations(conversationIds: Set<string>): Promise<void> {
    for (const [id, record] of [...this.records]) {
      if (!conversationIds.has(record.conversationId)) continue;
      this.records.delete(id);
      this.index.deleteToolCall(id);
    }
    for (const [id, cached] of [...this.terminalCache]) {
      if (!conversationIds.has(cached.record.conversationId)) continue;
      this.terminalCache.delete(id);
      this.terminalCacheBytes -= cached.bytes;
      this.index.deleteToolCall(id);
    }
  }

  private cacheTerminal(record: ToolCallRecord, bytes: number): void {
    if (!isTerminal(record.status) || bytes > TERMINAL_CACHE_MAX_BYTES) return;
    const existing = this.terminalCache.get(record.id);
    if (existing) {
      this.terminalCache.delete(record.id);
      this.terminalCacheBytes -= existing.bytes;
    }
    this.terminalCache.set(record.id, { record, bytes });
    this.terminalCacheBytes += bytes;
    while (this.terminalCacheBytes > TERMINAL_CACHE_MAX_BYTES) {
      const oldestId = this.terminalCache.keys().next().value as
        | string
        | undefined;
      if (!oldestId) break;
      const oldest = this.terminalCache.get(oldestId);
      this.terminalCache.delete(oldestId);
      this.terminalCacheBytes -= oldest?.bytes ?? 0;
    }
  }

  private path(record: Pick<ToolCallRecord, "id" | "conversationId">): string {
    if (
      !validId(record.id, "tool_") ||
      !validId(record.conversationId, "conv_")
    )
      throw new Error("Invalid tool-call storage identity.");
    return join(
      this.storage.paths.home,
      "conversations",
      record.conversationId,
      "tool-calls",
      `${record.id}.json`,
    );
  }

  private async serialize<T>(
    id: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.mutations.get(id) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.mutations.set(id, tail);
    try {
      return await result;
    } finally {
      if (this.mutations.get(id) === tail) this.mutations.delete(id);
    }
  }
}

const immutableKeys = [
  "id",
  "agentId",
  "conversationId",
  "projectId",
  "toolName",
  "sourceToolCallId",
  "providerToolCallId",
  "runId",
  "turnId",
  "liveMessageId",
  "contentIndex",
  "risk",
  "args",
  "cwd",
  "createdAt",
] as const;

function assertImmutableIdentity(
  current: ToolCallRecord,
  next: ToolCallRecord,
): void {
  for (const key of immutableKeys) {
    if (JSON.stringify(current[key]) !== JSON.stringify(next[key]))
      throw new Error(`Tool-call identity field '${key}' is immutable.`);
  }
}

function validId(value: string, prefix: string): boolean {
  return value.startsWith(prefix) && /^[A-Za-z0-9_-]+$/.test(value);
}

function isTerminal(status: ToolCallRecord["status"]): boolean {
  return ["completed", "denied", "failed", "cancelled"].includes(status);
}

function compareUpdatedDescending(
  left: ToolCallRecord,
  right: ToolCallRecord,
): number {
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.id.localeCompare(left.id)
  );
}
