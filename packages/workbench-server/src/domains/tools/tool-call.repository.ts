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
  /** Whether records came from the persisted index snapshot or the journal. */
  source: "snapshot" | "journal";
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
    source: "journal",
  };

  constructor(
    private readonly storage: InitializedStorage,
    private readonly index: IndexStore,
    private readonly options: ToolCallRepositoryOptions = {},
  ) {}

  /**
   * Hydrate the in-memory records. When the persisted index snapshot is
   * current (schema version matches and the journal size equals the recorded
   * watermark), records are loaded from sqlite instead of scanning the full
   * append-only journal, which can be hundreds of MB. The journal remains the
   * durable source of truth and is scanned whenever the snapshot is missing,
   * stale, or from an older schema.
   */
  async hydrate(): Promise<ToolCallRecord[]> {
    const fileBytes = await this.fileSize();
    const validation = this.index.isToolCallSnapshotValid(fileBytes);
    if (validation.valid) {
      const toolCalls = this.index.loadToolCalls();
      for (const toolCall of toolCalls) {
        this.records.set(toolCall.id, toolCall);
      }
      this.hydrationStats = {
        rowCount: toolCalls.length,
        uniqueCount: toolCalls.length,
        fileBytes,
        source: "snapshot",
      };
      return toolCalls;
    }
    const { records: toolCalls, stats } = await this.readLatest();
    this.hydrationStats = { ...stats, source: "journal" };
    for (const toolCall of toolCalls) {
      this.records.set(toolCall.id, toolCall);
      this.index.upsertToolCall(toolCall);
    }
    return toolCalls;
  }

  get hydrationSource(): "snapshot" | "journal" {
    return this.hydrationStats.source;
  }

  get hydrationStatsValue(): ToolCallHydrationStats {
    return { ...this.hydrationStats };
  }

  /**
   * Record the current journal watermark so the next startup can reuse the
   * persisted index snapshot. Called after a journal-based hydrate followed by
   * a full index rebuild, when the tool_calls table now mirrors the journal.
   */
  async markToolCallSnapshotPersisted(): Promise<void> {
    if (this.hydrationStats.source === "snapshot") return;
    await this.syncSnapshotMeta();
    this.hydrationStats = { ...this.hydrationStats, source: "snapshot" };
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
    await this.syncSnapshotMeta();
  }

  async removeForConversations(conversationIds: Set<string>): Promise<void> {
    for (const [id, toolCall] of this.records) {
      if (conversationIds.has(toolCall.conversationId)) {
        this.records.delete(id);
        this.index.deleteToolCall(id);
      }
    }
    await rewriteJsonLines(this.path(), this.list(), 0o600);
    await this.syncSnapshotMeta();
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
      source: this.hydrationStats.source,
    };
    await this.syncSnapshotMeta();
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
        source: "journal",
      },
    };
  }

  private fileSize(): Promise<number> {
    return stat(this.path()).then(
      (value) => value.size,
      () => 0,
    );
  }

  /**
   * Refresh the persisted snapshot metadata after any journal mutation so the
   * next startup can skip the full journal scan. The watermark is the exact
   * journal size, so appends/rewrites always invalidate a stale snapshot.
   * Best-effort: a failed meta write only costs a journal rehydrate on the
   * next startup, never correctness, so it must not break tool-call upserts.
   */
  private async syncSnapshotMeta(): Promise<void> {
    try {
      let latestUpdatedAt: string | null = null;
      for (const record of this.records.values()) {
        if (latestUpdatedAt === null || record.updatedAt > latestUpdatedAt) {
          latestUpdatedAt = record.updatedAt;
        }
      }
      this.index.writeToolCallSnapshot({
        watermark: await this.fileSize(),
        // The persisted row count is the validation source of truth; using the
        // in-memory map size could reject a valid snapshot when a single
        // table write diverged from memory (e.g. an upsert that did not land).
        rowCount: this.index.countToolCalls(),
        latestUpdatedAt,
      });
    } catch {
      // Ignored: the journal remains the durable source of truth.
    }
  }

  private path(): string {
    return join(this.storage.paths.home, "logs", "tool-calls.jsonl");
  }
}
