import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  LargestConversationUsage,
  StorageCategoryKey,
  StorageCategoryUsage,
  StorageCleanupTargetUsage,
  StorageUsageResponse,
} from "@nervekit/contracts";
import type { StoragePaths } from "../../infrastructure/storage/index.js";
import { dirSize, fileSize, type SizeTally } from "./storage-files.js";

export interface StorageUsageRegistryPort {
  listConversations(): Array<{ id: string; title: string | null }>;
}

export interface StorageUsageServiceDeps {
  paths: StoragePaths;
  getRegistry: () => StorageUsageRegistryPort;
}

interface CategoryMeta {
  label: string;
  description: string;
  cleanable: boolean;
  protected: boolean;
}

const CATEGORY_META: Record<StorageCategoryKey, CategoryMeta> = {
  conversations: {
    label: "Conversations",
    description: "Legacy conversation files pending migration.",
    cleanable: true,
    protected: false,
  },
  payloads: {
    label: "Payloads",
    description:
      "Complete tool results retained when agent output is truncated.",
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
    description:
      "Rebuildable query cache for recent durable events and records.",
    cleanable: true,
    protected: false,
  },
  exploreReports: {
    label: "Explore reports",
    description: "Saved output from codebase explore sub-agents.",
    cleanable: true,
    protected: false,
  },
  crashes: {
    label: "Crash reports",
    description: "Nerve crash reports and Node diagnostic reports.",
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
    description: "Approvals, user questions, and maintenance state.",
    cleanable: false,
    protected: false,
  },
  projects: {
    label: "Projects",
    description: "Project metadata.",
    cleanable: false,
    protected: false,
  },
  cache: {
    label: "Cache",
    description: "Disposable cached data.",
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
  "payloads",
  "conversations",
  "logs",
  "sqliteIndex",
  "exploreReports",
  "crashes",
  "cache",
  "tmp",
  "plans",
  "agents",
  "tasks",
  "workflowState",
  "projects",
  "other",
  "protected",
];
const USAGE_CACHE_TTL_MS = 15_000;
const LARGEST_CONVERSATION_LIMIT = 5;
const DATED_LOG = /^(application|desktop)-(\d{4}-\d{2}-\d{2})\.jsonl$/;

export class StorageUsageService {
  #cache?: { at: number; value: StorageUsageResponse };

  constructor(private readonly deps: StorageUsageServiceDeps) {}

  invalidate(): void {
    this.#cache = undefined;
  }

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
    const conversationSizes: Array<{ id: string; bytes: number }> = [];
    const add = (key: StorageCategoryKey, tally: SizeTally) => {
      const current = totals.get(key) ?? { bytes: 0, files: 0 };
      totals.set(key, {
        bytes: current.bytes + tally.bytes,
        files: current.files + tally.files,
      });
    };

    add("payloads", await dirSize(this.deps.paths.payloadsPath));
    add("exploreReports", await dirSize(this.deps.paths.reportsPath));
    add("plans", await dirSize(this.deps.paths.plansPath));
    add("tasks", await dirSize(this.deps.paths.tasksPath));
    add("logs", await dirSize(this.deps.paths.logsPath));
    add("crashes", await dirSize(this.deps.paths.crashesPath));
    add("cache", await dirSize(this.deps.paths.cachePath));
    add("tmp", await dirSize(this.deps.paths.tmpPath));
    add("agents", await dirSize(this.deps.paths.agentPath));
    add("other", await dirSize(this.deps.paths.imagesPath));
    add("other", await dirSize(this.deps.paths.migrationsPath));
    add("other", await dirSize(this.deps.paths.backupsPath));
    add("protected", await dirSize(this.deps.paths.configPath));
    add("protected", await dirSize(this.deps.paths.secretsPath));
    add("protected", await dirSize(this.deps.paths.tlsPath));
    add("protected", {
      bytes:
        (await fileSize(this.deps.paths.manifestPath)) +
        (await fileSize(this.deps.paths.daemonPath)),
      files: 2,
    });
    add("sqliteIndex", {
      bytes:
        (await fileSize(this.deps.paths.sqlitePath)) +
        (await fileSize(`${this.deps.paths.sqlitePath}-wal`)) +
        (await fileSize(`${this.deps.paths.sqlitePath}-shm`)),
      files: 3,
    });
    const conversationRoot = join(
      this.deps.paths.payloadsPath,
      "conversations",
    );
    const children = await readdir(conversationRoot, {
      withFileTypes: true,
    }).catch(() => []);
    for (const child of children) {
      if (!child.isDirectory() || child.isSymbolicLink()) continue;
      const tally = await dirSize(join(conversationRoot, child.name));
      conversationSizes.push({ id: child.name, bytes: tally.bytes });
    }

    const categories: StorageCategoryUsage[] = [];
    let totalBytes = 0;
    for (const key of CATEGORY_ORDER) {
      const tally = totals.get(key);
      if (!tally || tally.bytes === 0) continue;
      const meta = CATEGORY_META[key];
      categories.push({
        key,
        ...meta,
        fileCount: tally.files,
        bytes: tally.bytes,
      });
      totalBytes += tally.bytes;
    }

    const sqlite = {
      dbBytes: await fileSize(this.deps.paths.sqlitePath),
      walBytes: await fileSize(`${this.deps.paths.sqlitePath}-wal`),
      shmBytes: await fileSize(`${this.deps.paths.sqlitePath}-shm`),
    };
    const titleById = new Map(
      this.deps
        .getRegistry()
        .listConversations()
        .map((item) => [item.id, item.title]),
    );
    conversationSizes.sort((left, right) => right.bytes - left.bytes);
    const largest: LargestConversationUsage[] = conversationSizes
      .slice(0, LARGEST_CONVERSATION_LIMIT)
      .map((item) => ({
        conversationId: item.id,
        title: titleById.get(item.id) ?? null,
        bytes: item.bytes,
      }));

    const cleanupTargets = await this.cleanupTargetUsage(totals, sqlite);
    const value: StorageUsageResponse = {
      dataDir: home,
      generatedAt: new Date().toISOString(),
      totalBytes,
      categories,
      cleanupTargets,
      sqlite,
      conversations: { total: conversationSizes.length, largest },
    };
    this.#cache = { at: Date.now(), value };
    return value;
  }

  private async cleanupTargetUsage(
    totals: Map<StorageCategoryKey, SizeTally>,
    sqlite: StorageUsageResponse["sqlite"],
  ): Promise<StorageCleanupTargetUsage[]> {
    const home = this.deps.paths.home;
    const logsDir = join(home, "logs");
    const logEntries = await readdir(logsDir, { withFileTypes: true }).catch(
      () => [],
    );
    let datedBytes = 0;
    let datedItems = 0;
    for (const entry of logEntries) {
      if (!entry.isFile() || !DATED_LOG.test(entry.name)) continue;
      datedBytes += await fileSize(join(logsDir, entry.name));
      datedItems += 1;
    }
    const category = (key: StorageCategoryKey): SizeTally =>
      totals.get(key) ?? { bytes: 0, files: 0 };
    const rotatedBytes = await fileSize(join(logsDir, "events.jsonl.1"));
    return [
      {
        target: "conversations",
        bytes: category("payloads").bytes,
        itemCount: this.deps.getRegistry().listConversations().length,
        estimate: "upTo",
      },
      {
        target: "datedLogs",
        bytes: datedBytes,
        itemCount: datedItems,
        estimate: "upTo",
      },
      {
        target: "rotatedEventLog",
        bytes: rotatedBytes,
        itemCount: rotatedBytes > 0 ? 1 : 0,
        estimate: "exact",
      },
      {
        target: "exploreReports",
        bytes: category("exploreReports").bytes,
        itemCount: category("exploreReports").files,
        estimate: "exact",
      },
      {
        target: "crashReports",
        bytes: category("crashes").bytes,
        itemCount: category("crashes").files,
        estimate: "exact",
      },
      {
        target: "cache",
        bytes: category("cache").bytes,
        itemCount: category("cache").files,
        estimate: "exact",
      },
      {
        target: "tmp",
        bytes: category("tmp").bytes,
        itemCount: category("tmp").files,
        estimate: "exact",
      },
      {
        target: "searchIndex",
        bytes: sqlite.dbBytes + sqlite.walBytes + sqlite.shmBytes,
        itemCount: [sqlite.dbBytes, sqlite.walBytes, sqlite.shmBytes].filter(
          (bytes) => bytes > 0,
        ).length,
        estimate: "upTo",
      },
    ];
  }
}
