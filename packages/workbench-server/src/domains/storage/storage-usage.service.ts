import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  LargestConversationUsage,
  StorageCategoryKey,
  StorageCategoryUsage,
  StorageCleanupTargetUsage,
  StorageUsageResponse,
} from "@nervekit/contracts";
import type { StoragePaths } from "../../infrastructure/storage/index.js";
import {
  dirSize,
  fileSize,
  pathsSize,
  queryCacheFileNames,
  queryCacheFilePaths,
  sqliteFilePaths,
  type SizeTally,
} from "./storage-files.js";

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
  database: {
    label: "Canonical database",
    description: "Authoritative Nerve records. Never removed by cleanup.",
    cleanable: false,
    protected: true,
  },
  payloads: {
    label: "Payloads",
    description: "Retained tool results and other conversation payloads.",
    cleanable: true,
    protected: false,
  },
  reports: {
    label: "Reports",
    description: "Saved output from codebase explore sub-agents.",
    cleanable: true,
    protected: false,
  },
  images: {
    label: "Images",
    description: "Durable images managed by Nerve.",
    cleanable: false,
    protected: false,
  },
  plans: {
    label: "Plans",
    description: "Saved plan documents.",
    cleanable: false,
    protected: false,
  },
  tasks: {
    label: "Tasks",
    description: "Background task records, process metadata, and logs.",
    cleanable: false,
    protected: false,
  },
  agentResources: {
    label: "Agent resources",
    description: "Nerve-managed resources used by agents.",
    cleanable: false,
    protected: false,
  },
  runtimeState: {
    label: "Runtime state",
    description: "Idempotency and maintenance operation state.",
    cleanable: false,
    protected: false,
  },
  logs: {
    label: "Logs & events",
    description: "Application, desktop, event, and tool-call logs.",
    cleanable: true,
    protected: false,
  },
  crashReports: {
    label: "Crash reports",
    description: "Nerve crash reports and Node diagnostic reports.",
    cleanable: true,
    protected: false,
  },
  queryCache: {
    label: "Query cache",
    description:
      "A rebuildable SQLite read model sourced from canonical records.",
    cleanable: true,
    protected: false,
  },
  cache: {
    label: "Cache",
    description: "Disposable cached data other than the query cache.",
    cleanable: true,
    protected: false,
  },
  temporaryFiles: {
    label: "Temporary files",
    description: "Scratch files that can be safely removed.",
    cleanable: true,
    protected: false,
  },
  migrations: {
    label: "Migrations",
    description: "Migration ledger and reports retained for storage integrity.",
    cleanable: false,
    protected: false,
  },
  backups: {
    label: "Backups",
    description: "Retained Nerve-home backups that require manual removal.",
    cleanable: false,
    protected: false,
  },
  configurationIdentity: {
    label: "Configuration & identity",
    description:
      "Configuration, credentials, TLS identity, and daemon metadata.",
    cleanable: false,
    protected: true,
  },
  other: {
    label: "Other",
    description: "Unrecognized readable files under the Nerve home.",
    cleanable: false,
    protected: false,
  },
};

const CATEGORY_ORDER: StorageCategoryKey[] = [
  "database",
  "payloads",
  "reports",
  "images",
  "plans",
  "tasks",
  "agentResources",
  "runtimeState",
  "logs",
  "crashReports",
  "queryCache",
  "cache",
  "temporaryFiles",
  "migrations",
  "backups",
  "configurationIdentity",
  "other",
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

    const { paths } = this.deps;
    const totals = new Map<StorageCategoryKey, SizeTally>();
    const add = (key: StorageCategoryKey, tally: SizeTally) => {
      const current = totals.get(key) ?? { bytes: 0, files: 0 };
      totals.set(key, {
        bytes: current.bytes + tally.bytes,
        files: current.files + tally.files,
      });
    };

    const databaseTally = await pathsSize(sqliteFilePaths(paths.sqlitePath));
    const queryCacheTally = await pathsSize(
      queryCacheFilePaths(paths.queryCachePath),
    );
    const queryCacheNames = queryCacheFileNames(paths.queryCachePath);
    const conversationRoot = join(paths.payloadsPath, "conversations");
    const conversationPayloadTally = await dirSize(conversationRoot);

    add("database", databaseTally);
    add("payloads", await dirSize(paths.payloadsPath));
    add("reports", await dirSize(paths.reportsPath));
    add("images", await dirSize(paths.imagesPath));
    add("plans", await dirSize(paths.plansPath));
    add("tasks", await dirSize(paths.tasksPath));
    add("agentResources", await dirSize(paths.agentPath));
    add("runtimeState", await dirSize(paths.idempotencyPath));
    add("runtimeState", await dirSize(paths.maintenancePath));
    add("logs", await dirSize(paths.logsPath));
    add("crashReports", await dirSize(paths.crashesPath));
    add("queryCache", queryCacheTally);
    add("cache", await dirSize(paths.cachePath, queryCacheNames));
    add("temporaryFiles", await dirSize(paths.tmpPath));
    add("migrations", await dirSize(paths.migrationsPath));
    add("backups", await dirSize(paths.backupsPath));
    add("configurationIdentity", await dirSize(paths.configPath));
    add("configurationIdentity", await dirSize(paths.secretsPath));
    add("configurationIdentity", await dirSize(paths.tlsPath));
    add(
      "configurationIdentity",
      await pathsSize([paths.manifestPath, paths.daemonPath]),
    );

    const knownDataNames = new Set([
      ...sqliteFilePaths(paths.sqlitePath).map((path) => basename(path)),
      basename(paths.payloadsPath),
      basename(paths.reportsPath),
      basename(paths.imagesPath),
      basename(paths.plansPath),
      basename(paths.idempotencyPath),
      basename(paths.maintenancePath),
    ]);
    add("other", await dirSize(paths.dataPath, knownDataNames));

    const knownRootNames = new Set([
      basename(paths.dataPath),
      basename(paths.configPath),
      basename(paths.secretsPath),
      basename(paths.tlsPath),
      basename(paths.tmpPath),
      basename(paths.cachePath),
      basename(paths.logsPath),
      basename(paths.crashesPath),
      basename(paths.migrationsPath),
      basename(paths.backupsPath),
      basename(paths.tasksPath),
      basename(paths.agentPath),
      basename(paths.manifestPath),
      basename(paths.daemonPath),
    ]);
    add("other", await dirSize(paths.home, knownRootNames));

    const categories: StorageCategoryUsage[] = CATEGORY_ORDER.flatMap((key) => {
      const tally = totals.get(key);
      if (!tally || tally.bytes === 0) return [];
      return [
        {
          key,
          ...CATEGORY_META[key],
          fileCount: tally.files,
          bytes: tally.bytes,
        },
      ];
    });
    const totalBytes = categories.reduce(
      (sum, category) => sum + category.bytes,
      0,
    );

    const conversationSizes: Array<{ id: string; bytes: number }> = [];
    const children = await readdir(conversationRoot, {
      withFileTypes: true,
    }).catch(() => []);
    for (const child of children) {
      if (!child.isDirectory() || child.isSymbolicLink()) continue;
      conversationSizes.push({
        id: child.name,
        bytes: (await dirSize(join(conversationRoot, child.name))).bytes,
      });
    }
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

    const database = {
      dbBytes: (await fileSize(paths.sqlitePath)) ?? 0,
      walBytes: (await fileSize(`${paths.sqlitePath}-wal`)) ?? 0,
      shmBytes: (await fileSize(`${paths.sqlitePath}-shm`)) ?? 0,
    };
    const cleanupTargets = await this.cleanupTargetUsage(
      totals,
      queryCacheTally,
      conversationPayloadTally,
    );
    const value: StorageUsageResponse = {
      homeDir: paths.home,
      generatedAt: new Date().toISOString(),
      totalBytes,
      categories,
      cleanupTargets,
      database,
      conversations: { total: conversationSizes.length, largest },
    };
    this.#cache = { at: Date.now(), value };
    return value;
  }

  private async cleanupTargetUsage(
    totals: Map<StorageCategoryKey, SizeTally>,
    queryCache: SizeTally,
    conversationPayloads: SizeTally,
  ): Promise<StorageCleanupTargetUsage[]> {
    const logEntries = await readdir(this.deps.paths.logsPath, {
      withFileTypes: true,
    }).catch(() => []);
    let datedBytes = 0;
    let datedItems = 0;
    for (const entry of logEntries) {
      if (!entry.isFile() || !DATED_LOG.test(entry.name)) continue;
      datedBytes +=
        (await fileSize(join(this.deps.paths.logsPath, entry.name))) ?? 0;
      datedItems += 1;
    }
    const category = (key: StorageCategoryKey): SizeTally =>
      totals.get(key) ?? { bytes: 0, files: 0 };
    const rotatedBytes =
      (await fileSize(join(this.deps.paths.logsPath, "events.jsonl.1"))) ?? 0;
    return [
      {
        target: "conversations",
        bytes: conversationPayloads.bytes,
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
        bytes: category("reports").bytes,
        itemCount: category("reports").files,
        estimate: "exact",
      },
      {
        target: "crashReports",
        bytes: category("crashReports").bytes,
        itemCount: category("crashReports").files,
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
        bytes: category("temporaryFiles").bytes,
        itemCount: category("temporaryFiles").files,
        estimate: "exact",
      },
      {
        target: "searchIndex",
        bytes: queryCache.bytes,
        itemCount: queryCache.files,
        estimate: "upTo",
      },
    ];
  }
}
