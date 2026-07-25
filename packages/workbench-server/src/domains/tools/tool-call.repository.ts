import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { ToolCallRecord } from "@nervekit/contracts";
import type { IndexStore } from "../../infrastructure/index-store/index.js";
import {
  appendJsonLine,
  forEachJsonLine,
  type InitializedStorage,
  rewriteJsonLines,
} from "../../infrastructure/storage/index.js";

const DEFAULT_COMPACTION_MINIMUM_BYTES = 16 * 1024 * 1024;
const DEFAULT_COMPACTION_AMPLIFICATION = 2;

export interface ToolCallHydrationStats {
  rowCount: number;
  uniqueCount: number;
  fileBytes: number;
}

export interface ToolCallRepositoryOptions {
  compactionMinimumBytes?: number;
  compactionAmplification?: number;
}

export class ToolCallRepository {
  readonly records = new Map<string, ToolCallRecord>();
  private hydrationStats: ToolCallHydrationStats = {
    rowCount: 0,
    uniqueCount: 0,
    fileBytes: 0,
  };

  constructor(
    private readonly storage: InitializedStorage,
    private readonly index: IndexStore,
    private readonly options: ToolCallRepositoryOptions = {},
  ) {}

  async hydrate(): Promise<ToolCallRecord[]> {
    const { records: toolCalls, stats } = await this.readLatest();
    this.hydrationStats = stats;
    for (const toolCall of toolCalls) {
      this.records.set(toolCall.id, toolCall);
      this.index.upsertToolCall(toolCall);
    }
    return toolCalls;
  }

  list(): ToolCallRecord[] {
    return [...this.records.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  get(toolCallId: string): ToolCallRecord {
    const toolCall = this.records.get(toolCallId);
    if (!toolCall) throw new Error("Tool call not found.");
    return toolCall;
  }

  findByProviderToolCallId(
    providerToolCallId: string | undefined,
  ): ToolCallRecord | undefined {
    if (!providerToolCallId) return undefined;
    return [...this.records.values()].find(
      (toolCall) =>
        toolCall.providerToolCallId === providerToolCallId ||
        toolCall.sourceToolCallId === providerToolCallId,
    );
  }

  async upsert(toolCall: ToolCallRecord): Promise<void> {
    this.records.set(toolCall.id, toolCall);
    this.index.upsertToolCall(toolCall);
    await appendJsonLine(this.path(), toolCall, 0o600);
  }

  async removeForConversations(conversationIds: Set<string>): Promise<void> {
    for (const [id, toolCall] of this.records) {
      if (conversationIds.has(toolCall.conversationId)) {
        this.records.delete(id);
        this.index.deleteToolCall(id);
      }
    }
    await rewriteJsonLines(this.path(), this.list(), 0o600);
  }

  /**
   * Rewrite the persisted log to only the latest version of each tool call,
   * dropping the superseded append duplicates that accumulate via `upsert`.
   * Frees disk without losing any tool call and keeps the file in sync with the
   * in-memory map. Returns the file size delta (bytes freed).
   */
  async compactPersisted(): Promise<void> {
    const records = this.list();
    await rewriteJsonLines(this.path(), records, 0o600);
    this.hydrationStats = {
      rowCount: records.length,
      uniqueCount: records.length,
      fileBytes: await this.fileSize(),
    };
  }

  async compactPersistedIfAmplified(): Promise<
    | { before: ToolCallHydrationStats; after: ToolCallHydrationStats }
    | undefined
  > {
    const before = { ...this.hydrationStats };
    const minimumBytes =
      this.options.compactionMinimumBytes ?? DEFAULT_COMPACTION_MINIMUM_BYTES;
    const amplification =
      this.options.compactionAmplification ?? DEFAULT_COMPACTION_AMPLIFICATION;
    if (
      before.fileBytes < minimumBytes ||
      before.rowCount < before.uniqueCount * amplification
    ) {
      return undefined;
    }
    await this.compactPersisted();
    return { before, after: { ...this.hydrationStats } };
  }

  persistedPath(): string {
    return this.path();
  }

  private async readLatest(): Promise<{
    records: ToolCallRecord[];
    stats: ToolCallHydrationStats;
  }> {
    const byId = new Map<string, ToolCallRecord>();
    let rowCount = 0;
    await forEachJsonLine<ToolCallRecord>(this.path(), (toolCall) => {
      rowCount += 1;
      byId.set(toolCall.id, toolCall);
    }).catch(() => undefined);
    return {
      records: [...byId.values()],
      stats: {
        rowCount,
        uniqueCount: byId.size,
        fileBytes: await this.fileSize(),
      },
    };
  }

  private fileSize(): Promise<number> {
    return stat(this.path()).then(
      (value) => value.size,
      () => 0,
    );
  }

  private path(): string {
    return join(this.storage.paths.home, "logs", "tool-calls.jsonl");
  }
}
