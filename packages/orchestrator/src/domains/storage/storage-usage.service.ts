import { mkdir, readdir, rm, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type {
  LargestConversationUsage,
  StorageCategoryKey,
  StorageCategoryUsage,
  StorageCleanupRequest,
  StorageCleanupResponse,
  StorageCleanupResult,
  StorageUsageResponse,
} from "@nerve/shared";
import type { IndexStore } from "../../infrastructure/index-store/index.js";
import type { StoragePaths } from "../../infrastructure/storage/index.js";

/** Minimal registry surface needed for usage/cleanup (avoids an import cycle). */
export interface StorageRegistryPort {
  pruneConversationsAcrossProjects(request: {
    strategy: "olderThanDays";
    olderThanDays: number;
  }): Promise<{ prunedConversationIds: string[]; skippedCount: number }>;
  listConversations(): Array<{ id: string; title: string | null }>;
  tools: {
    compactToolCallLog(): Promise<void>;
    toolCallLogPath(): string;
  };
}

export interface StorageUsageServiceDeps {
  paths: StoragePaths;
  index: IndexStore;
  getRegistry: () => StorageRegistryPort;
}

interface SizeTally {
  bytes: number;
  files: number;
}

interface CategoryMeta {
  label: string;
  description: string;
  cleanable: boolean;
  protected: boolean;
}

// Display order + metadata for known categories.
const CATEGORY_META: Record<StorageCategoryKey, CategoryMeta> = {
  conversations: {
    label: "Conversations",
    description:
      "Message history, harness state, and entries per conversation.",
    cleanable: true,
    protected: false,
  },
  logs: {
    label: "Logs & events",
    description:
      "Application logs, the global event log, and tool-call history.",
    cleanable: true,
    protected: false,
  },
  sqliteIndex: {
    label: "Search index (SQLite)",
    description: "Rebuildable query cache. Vacuum to reclaim freed pages.",
    cleanable: true,
    protected: false,
  },
  exploreReports: {
    label: "Explore reports",
    description: "Saved output from codebase explore sub-agents.",
    cleanable: true,
    protected: false,
  },
  plans: {
    label: "Plans",
    description: "Saved plan documents.",
    cleanable: false,
    protected: false,
  },
  agents: {
    label: "Agents",
    description: "Per-agent runtime state.",
    cleanable: false,
    protected: false,
  },
  tasks: {
    label: "Tasks",
    description: "Background task state and logs.",
    cleanable: false,
    protected: false,
  },
  workflowState: {
    label: "Workflow state",
    description: "Suspensions, approvals, user questions, and handovers.",
    cleanable: false,
    protected: false,
  },
  projects: {
    label: "Projects",
    description: "Project metadata.",
    cleanable: false,
    protected: false,
  },
  workers: {
    label: "Workers",
    description: "Worker registrations.",
    cleanable: false,
    protected: false,
  },
  cache: {
    label: "Cache",
    description: "Disposable cached data (e.g. usage snapshots).",
    cleanable: true,
    protected: false,
  },
  tmp: {
    label: "Temporary files",
    description: "Scratch files that can be safely removed.",
    cleanable: true,
    protected: false,
  },
  protected: {
    label: "Credentials & config",
    description: "Auth tokens, keys, TLS, and configuration. Never deleted.",
    cleanable: false,
    protected: true,
  },
  other: {
    label: "Other",
    description: "Uncategorized data under the Nerve home directory.",
    cleanable: false,
    protected: false,
  },
};

const CATEGORY_ORDER: StorageCategoryKey[] = [
  "conversations",
  "logs",
  "sqliteIndex",
  "exploreReports",
  "cache",
  "tmp",
  "plans",
  "agents",
  "tasks",
  "workflowState",
  "projects",
  "workers",
  "other",
  "protected",
];

const USAGE_CACHE_TTL_MS = 15_000;
const LARGEST_CONVERSATION_LIMIT = 5;

export class StorageUsageService {
  #cache?: { at: number; value: StorageUsageResponse };

  constructor(private readonly deps: StorageUsageServiceDeps) {}

  async computeUsage(force = false): Promise<StorageUsageResponse> {
    if (
      !force &&
      this.#cache &&
      Date.now() - this.#cache.at < USAGE_CACHE_TTL_MS
    ) {
      return this.#cache.value;
    }
    const home = this.deps.paths.home;
    const totals = new Map<StorageCategoryKey, SizeTally>();
    const add = (key: StorageCategoryKey, tally: SizeTally) => {
      const current = totals.get(key) ?? { bytes: 0, files: 0 };
      current.bytes += tally.bytes;
      current.files += tally.files;
      totals.set(key, current);
    };

    const entries = await readdir(home, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const key = categoryForEntry(entry.name);
      const path = join(home, entry.name);
      const tally = entry.isDirectory()
        ? await dirSize(path)
        : { bytes: await fileSize(path), files: 1 };
      add(key, tally);
    }

    const categories: StorageCategoryUsage[] = [];
    let totalBytes = 0;
    for (const key of CATEGORY_ORDER) {
      const tally = totals.get(key);
      if (!tally || tally.bytes === 0) continue;
      const meta = CATEGORY_META[key];
      categories.push({
        key,
        label: meta.label,
        description: meta.description,
        bytes: tally.bytes,
        fileCount: tally.files,
        cleanable: meta.cleanable,
        protected: meta.protected,
      });
      totalBytes += tally.bytes;
    }

    const sqlite = {
      dbBytes: await fileSize(this.deps.paths.sqlitePath),
      walBytes: await fileSize(`${this.deps.paths.sqlitePath}-wal`),
      shmBytes: await fileSize(`${this.deps.paths.sqlitePath}-shm`),
    };

    const conversations = await this.conversationUsage();

    const value: StorageUsageResponse = {
      dataDir: home,
      generatedAt: new Date().toISOString(),
      totalBytes,
      categories,
      sqlite,
      conversations,
    };
    this.#cache = { at: Date.now(), value };
    return value;
  }

  async cleanup(
    request: StorageCleanupRequest,
  ): Promise<StorageCleanupResponse> {
    const results: StorageCleanupResult[] = [];

    if (request.conversationsOlderThanDays !== undefined) {
      results.push(
        await this.runTarget("conversations", async () => {
          const dir = join(this.deps.paths.home, "conversations");
          const before = (await dirSize(dir)).bytes;
          const pruned = await this.deps
            .getRegistry()
            .pruneConversationsAcrossProjects({
              strategy: "olderThanDays",
              olderThanDays: request.conversationsOlderThanDays as number,
            });
          const after = (await dirSize(dir)).bytes;
          return {
            freedBytes: Math.max(0, before - after),
            removedItems: pruned.prunedConversationIds.length,
            skipped: pruned.skippedCount,
          };
        }),
      );
    }

    if (request.logsOlderThanDays !== undefined) {
      results.push(
        await this.runTarget("logs", () =>
          this.pruneDatedLogs(request.logsOlderThanDays as number),
        ),
      );
    }

    if (request.truncateEventLog) {
      results.push(
        await this.runTarget("rotatedEventLog", () =>
          this.removeFile(join(this.deps.paths.home, "logs", "events.jsonl.1")),
        ),
      );
    }

    if (request.clearToolCallLog) {
      results.push(
        await this.runTarget("toolCallLog", async () => {
          const path = this.deps.getRegistry().tools.toolCallLogPath();
          const before = await fileSize(path);
          await this.deps.getRegistry().tools.compactToolCallLog();
          const after = await fileSize(path);
          return {
            freedBytes: Math.max(0, before - after),
            removedItems: 0,
            skipped: 0,
            note: "Compacted superseded tool-call rows.",
          };
        }),
      );
    }

    if (request.clearExploreReports) {
      results.push(
        await this.runTarget("exploreReports", () =>
          this.clearDirContents(join(this.deps.paths.home, "explore-reports")),
        ),
      );
    }

    if (request.clearCache) {
      results.push(
        await this.runTarget("cache", () =>
          this.clearDirContents(join(this.deps.paths.home, "cache")),
        ),
      );
    }

    if (request.clearTmp) {
      results.push(
        await this.runTarget("tmp", () =>
          this.clearDirContents(join(this.deps.paths.home, "tmp")),
        ),
      );
    }

    if (request.vacuumSqlite) {
      results.push(
        await this.runTarget("sqliteVacuum", async () => {
          const before =
            (await fileSize(this.deps.paths.sqlitePath)) +
            (await fileSize(`${this.deps.paths.sqlitePath}-wal`));
          const ok = this.deps.index.vacuum();
          const after =
            (await fileSize(this.deps.paths.sqlitePath)) +
            (await fileSize(`${this.deps.paths.sqlitePath}-wal`));
          return {
            freedBytes: Math.max(0, before - after),
            removedItems: 0,
            skipped: ok ? 0 : 1,
            note: ok ? undefined : "VACUUM failed (likely insufficient disk).",
          };
        }),
      );
    }

    this.#cache = undefined;
    const usage = await this.computeUsage(true);
    const freedBytes = results.reduce((sum, r) => sum + r.freedBytes, 0);
    return { freedBytes, results, usage };
  }

  private async runTarget(
    target: string,
    run: () => Promise<Omit<StorageCleanupResult, "target">>,
  ): Promise<StorageCleanupResult> {
    try {
      return { target, ...(await run()) };
    } catch (error) {
      return {
        target,
        freedBytes: 0,
        removedItems: 0,
        skipped: 1,
        note: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async conversationUsage(): Promise<
    StorageUsageResponse["conversations"]
  > {
    const dir = join(this.deps.paths.home, "conversations");
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const sized: Array<{ id: string; bytes: number }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const bytes = (await dirSize(join(dir, entry.name))).bytes;
      sized.push({ id: entry.name, bytes });
    }
    sized.sort((a, b) => b.bytes - a.bytes);
    const titleById = new Map<string, string | null>(
      this.deps
        .getRegistry()
        .listConversations()
        .map((c) => [c.id, c.title]),
    );
    const largest: LargestConversationUsage[] = sized
      .slice(0, LARGEST_CONVERSATION_LIMIT)
      .map((item) => ({
        conversationId: item.id,
        title: titleById.get(item.id) ?? null,
        bytes: item.bytes,
      }));
    return { total: sized.length, largest };
  }

  private async pruneDatedLogs(
    olderThanDays: number,
  ): Promise<Omit<StorageCleanupResult, "target">> {
    const logsDir = join(this.deps.paths.home, "logs");
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const datedLog = /^(application|desktop)-(\d{4}-\d{2}-\d{2})\.jsonl$/;
    const files = await readdir(logsDir).catch(() => []);
    let freedBytes = 0;
    let removedItems = 0;
    for (const file of files) {
      const match = datedLog.exec(file);
      if (!match) continue;
      if (match[2] >= cutoff) continue; // keep recent + today's files
      const path = join(logsDir, file);
      freedBytes += await fileSize(path);
      await unlink(path).catch(() => undefined);
      removedItems += 1;
    }
    return { freedBytes, removedItems, skipped: 0 };
  }

  private async removeFile(
    path: string,
  ): Promise<Omit<StorageCleanupResult, "target">> {
    const bytes = await fileSize(path);
    if (bytes === 0) return { freedBytes: 0, removedItems: 0, skipped: 0 };
    await unlink(path).catch(() => undefined);
    return { freedBytes: bytes, removedItems: 1, skipped: 0 };
  }

  private async clearDirContents(
    path: string,
  ): Promise<Omit<StorageCleanupResult, "target">> {
    const entries = await readdir(path, { withFileTypes: true }).catch(
      () => [],
    );
    let freedBytes = 0;
    let removedItems = 0;
    for (const entry of entries) {
      const child = join(path, entry.name);
      freedBytes += entry.isDirectory()
        ? (await dirSize(child)).bytes
        : await fileSize(child);
      await rm(child, { recursive: true, force: true }).catch(() => undefined);
      removedItems += 1;
    }
    await mkdir(path, { recursive: true }).catch(() => undefined);
    return { freedBytes, removedItems, skipped: 0 };
  }
}

function categoryForEntry(name: string): StorageCategoryKey {
  switch (name) {
    case "conversations":
      return "conversations";
    case "logs":
      return "logs";
    case "state.sqlite":
    case "state.sqlite-wal":
    case "state.sqlite-shm":
      return "sqliteIndex";
    case "explore-reports":
      return "exploreReports";
    case "plans":
      return "plans";
    case "agents":
      return "agents";
    case "tasks":
      return "tasks";
    case "suspensions":
    case "approvals":
    case "user-questions":
    case "handover":
    case "handovers":
      return "workflowState";
    case "projects":
      return "projects";
    case "workers":
      return "workers";
    case "cache":
      return "cache";
    case "tmp":
      return "tmp";
    case "auth":
    case "keys":
    case "tls":
    case "config.json":
    case "providers.json":
    case "daemon.json":
      return "protected";
    default:
      return "other";
  }
}

async function dirSize(path: string): Promise<SizeTally> {
  let bytes = 0;
  let files = 0;
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      const nested = await dirSize(child);
      bytes += nested.bytes;
      files += nested.files;
    } else if (entry.isFile()) {
      bytes += await fileSize(child);
      files += 1;
    }
  }
  return { bytes, files };
}

async function fileSize(path: string): Promise<number> {
  return stat(path)
    .then((info) => info.size)
    .catch(() => 0);
}
