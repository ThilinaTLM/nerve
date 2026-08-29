import {
  toolCallRecordSchema,
  type ConversationJournalEvent,
  type ToolCallDetails,
  type ToolCallRecord,
  type ToolCallResultChunk,
  type ToolCallTranscriptRecord,
} from "@nervekit/contracts";
import { createHash } from "node:crypto";
import type {
  RuntimeQueryCache,
  ToolCallPreviewQuery,
} from "../../../infrastructure/persistence/query-cache/index.js";
import { storagePaths } from "../../../infrastructure/storage-bootstrap/paths.js";
import { ConversationJournalRepository } from "../../conversations/conversation-journal.repository.js";
import { toToolCallTranscriptRecord } from "./tool-call-transcript-preview.js";
import {
  serializeToolResult,
  ToolResultPayloadCorruptError,
  type ToolResultPayloadStore,
  ToolResultPayloadUnavailableError,
  utf8TextRange,
} from "./tool-result-payload-store.js";

const TERMINAL_CACHE_MAX_BYTES = 16 * 1024 * 1024;

export interface ToolCallHydrationStats {
  rowCount: number;
  uniqueCount: number;
  fileBytes: number;
  activeCount: number;
  source: "journal";
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

/** Journal-backed canonical tool-call projection. */
export class ToolCallRepository {
  readonly records: Map<string, ToolCallRecord> = new Map();
  private readonly terminalCache = new Map<
    string,
    { record: ToolCallRecord; bytes: number }
  >();
  private terminalCacheBytes = 0;
  private readonly providerToolCallIds = new Map<string, string>();
  private readonly mutations = new Map<string, Promise<void>>();
  private hydrationStats: ToolCallHydrationStats = {
    rowCount: 0,
    uniqueCount: 0,
    fileBytes: 0,
    activeCount: 0,
    source: "journal",
  };

  private readonly journal: ConversationJournalRepository;
  private readonly queryCache: RuntimeQueryCache;

  constructor(
    journalOrStorage:
      | ConversationJournalRepository
      | { paths: { home: string } },
    queryCache: RuntimeQueryCache,
    private readonly payloads?: ToolResultPayloadStore,
  ) {
    this.journal =
      journalOrStorage instanceof ConversationJournalRepository
        ? journalOrStorage
        : new ConversationJournalRepository({
            ...journalOrStorage,
            paths: storagePaths(journalOrStorage.paths.home),
          });
    this.queryCache = queryCache;
  }

  async hydrate(
    onRecord?: (record: ToolCallRecord) => void,
  ): Promise<ToolCallRecord[]> {
    this.records.clear();
    this.providerToolCallIds.clear();
    this.terminalCache.clear();
    this.terminalCacheBytes = 0;
    const ids = new Set<string>();
    let rowCount = 0;
    this.queryCache.beginToolCallRebuild();
    try {
      for (const state of await this.journal.hydrateAll()) {
        for (const record of [...state.toolCalls.values()].sort((left, right) =>
          left.id.localeCompare(right.id),
        )) {
          if (ids.has(record.id)) {
            throw new Error(`Duplicate canonical tool call '${record.id}'.`);
          }
          ids.add(record.id);
          rowCount += 1;
          this.queryCache.appendToolCallRebuild(
            record,
            toToolCallTranscriptRecord(record),
          );
          if (!isTerminal(record.status)) {
            this.records.set(record.id, record);
            this.indexProviderIds(record);
          }
          onRecord?.(record);
        }
      }
      this.queryCache.finishToolCallRebuild();
    } catch (error) {
      this.queryCache.rollbackToolCallRebuild();
      throw error;
    }
    this.hydrationStats = {
      rowCount,
      uniqueCount: rowCount,
      fileBytes: 0,
      activeCount: this.records.size,
      source: "journal",
    };
    return this.listActive();
  }

  get hydrationSource(): "journal" {
    return "journal";
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
    return this.queryCache.countToolCalls();
  }

  listActive(): ToolCallRecord[] {
    return [...this.records.values()].sort(compareUpdatedDescending);
  }

  listPreviews(query: ToolCallPreviewQuery = {}): ToolCallTranscriptRecord[] {
    return this.queryCache.listToolCallPreviews(query);
  }

  queryPreviews(query: ToolCallPreviewQuery = {}) {
    return this.queryCache.queryToolCallPreviews(query);
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
    if (cached) return cached.record;
    const conversationId = this.queryCache.toolCallConversationId(toolCallId);
    if (!conversationId) throw new Error("Tool call not found.");
    const stored = (await this.journal.load(conversationId)).toolCalls.get(
      toolCallId,
    );
    if (!stored) throw new Error("Tool call not found.");
    this.cacheTerminal(stored, Buffer.byteLength(JSON.stringify(stored)));
    return stored;
  }

  async getDetails(toolCallId: string): Promise<ToolCallDetails> {
    const toolCall = await this.getCanonical(toolCallId);
    if (!toolCall.resultPayload) {
      const serialized = serializedInlineResult(toolCall.result);
      return {
        toolCall,
        completeResult: {
          status: "inline",
          hasResult: toolCall.result !== undefined,
          byteLength: serialized.byteLength,
          mediaType: "application/json",
          encoding: "utf-8",
          digest: createHash("sha256").update(serialized).digest("hex"),
        },
      };
    }
    const reference = toolCall.resultPayload;
    return {
      toolCall,
      completeResult: {
        status: this.payloads
          ? reference.completeness === "legacy_bounded"
            ? "legacy_bounded"
            : "payload"
          : "unavailable",
        hasResult: true,
        byteLength: reference.byteLength,
        mediaType: reference.mediaType,
        encoding: reference.encoding,
        digest: reference.digest,
      },
    };
  }

  async readResult(
    toolCallId: string,
    byteOffset: number,
    byteLimit: number,
  ): Promise<ToolCallResultChunk> {
    const toolCall = await this.getCanonical(toolCallId);
    const reference = toolCall.resultPayload;
    if (!reference) {
      const serialized = serializedInlineResult(toolCall.result);
      const offset = Math.min(byteOffset, serialized.byteLength);
      const bounded = utf8TextRange(
        serialized.subarray(
          offset,
          Math.min(serialized.byteLength, offset + byteLimit + 6),
        ),
        byteLimit,
      );
      const actualOffset = offset + bounded.start;
      const nextByteOffset = offset + bounded.end;
      return {
        status: "inline",
        totalBytes: serialized.byteLength,
        byteOffset: actualOffset,
        nextByteOffset,
        text: bounded.text,
        done: nextByteOffset >= serialized.byteLength,
      };
    }
    if (!this.payloads) {
      return unavailableResultChunk(
        "unavailable",
        reference.byteLength,
        byteOffset,
      );
    }
    try {
      const range = await this.payloads.readTextRange(
        reference,
        byteOffset,
        byteLimit,
      );
      return {
        status:
          reference.completeness === "legacy_bounded"
            ? "legacy_bounded"
            : "payload",
        totalBytes: range.totalBytes,
        byteOffset: range.byteOffset,
        nextByteOffset: range.nextByteOffset,
        text: range.text,
        done: range.nextByteOffset >= range.totalBytes,
      };
    } catch (error) {
      if (error instanceof ToolResultPayloadCorruptError) {
        return unavailableResultChunk(
          "corrupt",
          reference.byteLength,
          byteOffset,
        );
      }
      if (error instanceof ToolResultPayloadUnavailableError) {
        return unavailableResultChunk(
          "unavailable",
          reference.byteLength,
          byteOffset,
        );
      }
      throw error;
    }
  }

  findByProviderToolCallId(
    providerToolCallId: string | undefined,
  ): ToolCallRecord | undefined {
    if (!providerToolCallId) return undefined;
    const id = this.providerToolCallIds.get(providerToolCallId);
    if (!id) return undefined;
    return this.records.get(id) ?? this.terminalCache.get(id)?.record;
  }

  async create(toolCall: ToolCallRecord): Promise<ToolCallRecord> {
    const record = toolCallRecordSchema.parse({ ...toolCall, revision: 1 });
    return this.serialize(record.id, async () => {
      const state = await this.journal.load(record.conversationId);
      if (state.toolCalls.has(record.id)) {
        throw new Error(`Tool call '${record.id}' already exists.`);
      }
      await this.journal.commit(record.conversationId, {
        kind: "tool_call.created",
        events: [
          {
            kind: "tool_call.upserted",
            conversationId: record.conversationId,
            toolCall: record,
          },
        ],
      });
      this.observe(record);
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
      if (isTerminal(current.status)) {
        throw new Error(`Terminal tool call '${toolCallId}' is immutable.`);
      }
      const candidate = mutate(current);
      assertImmutableIdentity(current, candidate);
      const next = toolCallRecordSchema.parse({
        ...candidate,
        revision: current.revision + 1,
      });
      const journalState = await this.journal.load(next.conversationId);
      const events: ConversationJournalEvent[] = [
        {
          kind: "tool_call.upserted",
          conversationId: next.conversationId,
          toolCall: next,
        },
      ];
      const suspensions = new Set<string>();
      const interactionIds =
        journalState.interactionIdsByToolCall.get(next.id) ?? new Set<string>();
      for (const interactionId of interactionIds) {
        const normalized = journalState.interactions.get(interactionId);
        if (!normalized) continue;
        const interaction = next.interactions[normalized.interaction.ordinal];
        if (!interaction) continue;
        events.push({
          kind: "interaction.upserted",
          conversationId: next.conversationId,
          interaction: {
            ...normalized,
            toolCallRevision: next.revision,
            interaction,
          },
        });
        suspensions.add(normalized.suspensionId);
      }
      for (const suspensionId of suspensions) {
        const suspension = journalState.suspensions.get(suspensionId);
        if (!suspension) continue;
        events.push({
          kind: "suspension.upserted",
          conversationId: next.conversationId,
          suspension: {
            ...suspension,
            members: suspension.members.map((member) =>
              member.toolCallId === next.id
                ? { ...member, toolCallRevision: next.revision }
                : member,
            ),
            updatedAt: next.updatedAt,
          },
        });
      }
      await this.journal.commit(next.conversationId, {
        kind: "tool_call.revised",
        events,
      });
      this.observe(next);
      return next;
    });
  }

  async removeForConversations(conversationIds: Set<string>): Promise<void> {
    for (const [id, record] of [...this.records]) {
      if (!conversationIds.has(record.conversationId)) continue;
      this.records.delete(id);
      this.unindexProviderIds(record);
      this.queryCache.deleteToolCall(id);
    }
    for (const [id, cached] of [...this.terminalCache]) {
      if (!conversationIds.has(cached.record.conversationId)) continue;
      this.terminalCache.delete(id);
      this.terminalCacheBytes -= cached.bytes;
      this.unindexProviderIds(cached.record);
      this.queryCache.deleteToolCall(id);
    }
  }

  private observe(record: ToolCallRecord): void {
    this.indexProviderIds(record);
    if (isTerminal(record.status)) {
      this.records.delete(record.id);
      this.cacheTerminal(record, Buffer.byteLength(JSON.stringify(record)));
    } else {
      this.records.set(record.id, record);
    }
    try {
      this.queryCache.upsertToolCall(
        record,
        toToolCallTranscriptRecord(record),
      );
    } catch {
      // The journal remains authoritative; SQLite is disposable.
    }
  }

  private cacheTerminal(record: ToolCallRecord, bytes: number): void {
    if (!isTerminal(record.status)) return;
    if (bytes > TERMINAL_CACHE_MAX_BYTES) {
      this.unindexProviderIds(record);
      return;
    }
    this.indexProviderIds(record);
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
      if (oldest) this.unindexProviderIds(oldest.record);
    }
  }

  private indexProviderIds(record: ToolCallRecord): void {
    for (const id of [record.providerToolCallId, record.sourceToolCallId]) {
      if (id) this.providerToolCallIds.set(id, record.id);
    }
  }

  private unindexProviderIds(record: ToolCallRecord): void {
    for (const id of [record.providerToolCallId, record.sourceToolCallId]) {
      if (id && this.providerToolCallIds.get(id) === record.id) {
        this.providerToolCallIds.delete(id);
      }
    }
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
    if (JSON.stringify(current[key]) !== JSON.stringify(next[key])) {
      throw new Error(`Tool-call identity field '${key}' is immutable.`);
    }
  }
}

function serializedInlineResult(result: unknown): Buffer {
  return Buffer.from(
    result === undefined ? "" : serializeToolResult(result),
    "utf8",
  );
}

function unavailableResultChunk(
  status: "unavailable" | "corrupt",
  totalBytes: number,
  byteOffset: number,
): ToolCallResultChunk {
  const offset = Math.min(byteOffset, totalBytes);
  return {
    status,
    totalBytes,
    byteOffset: offset,
    nextByteOffset: offset,
    text: "",
    done: true,
  };
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
