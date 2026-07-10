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
    description:
      "Suspensions, approvals, user questions, handovers, and maintenance state.",
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

    const entries = await readdir(home, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const key = categoryForEntry(entry.name);
      const path = join(home, entry.name);
      if (entry.isDirectory() && key === "conversations") {
        const children = await readdir(path, { withFileTypes: true }).catch(
          () => [],
        );
        for (const child of children) {
          if (!child.isDirectory() || child.isSymbolicLink()) continue;
          const tally = await dirSize(join(path, child.name));
          add(key, tally);
          conversationSizes.push({ id: child.name, bytes: tally.bytes });
        }
      } else {
        add(
          key,
          entry.isDirectory()
            ? await dirSize(path)
            : { bytes: await fileSize(path), files: 1 },
        );
      }
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
    const toolLogBytes = await fileSize(join(logsDir, "tool-calls.jsonl"));
    return [
      {
        target: "conversations",
        bytes: category("conversations").bytes,
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
        target: "toolCallLog",
        bytes: toolLogBytes,
        itemCount: toolLogBytes > 0 ? 1 : 0,
        estimate: "upTo",
      },
      {
        target: "exploreReports",
        bytes: category("exploreReports").bytes,
        itemCount: category("exploreReports").files,
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
    case "maintenance":
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
