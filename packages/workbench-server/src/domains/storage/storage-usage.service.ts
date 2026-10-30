import { readArchivedHome } from "../../infrastructure/storage-bootstrap/start-fresh.js";
import { basename } from "node:path";
import type {
  LargestConversationUsage,
  StorageCategoryKey,
  StorageCategoryUsage,
  StorageCleanupTargetUsage,
  StorageUsageResponse,
} from "@nervekit/contracts/storage";
import {
  managedOwnerId,
  type StoragePaths,
} from "../../infrastructure/storage-bootstrap/index.js";
import {
  dirSize,
  fileSize,
  scanDirectoryUsage,
  pathsSize,
  sqliteFilePaths,
  type SizeTally,
} from "./storage-files.js";

export interface StorageUsageSource {
  listConversations(): Array<{ id: string; title: string | null }>;
}

export interface StorageUsageServiceDeps {
  paths: StoragePaths;
  getSource: () => StorageUsageSource;
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
    label: "Conversation files",
    description:
      "Retained tool results, sub-agent reports and other conversation-owned files.",
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
  agentResources: {
    label: "Agent resources",
    description: "Nerve-managed resources used by agents.",
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
  cache: {
    label: "Cache",
    description: "Disposable cached data.",
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
  "images",
  "plans",
  "agentResources",
  "logs",
  "crashReports",
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
  #generation = 0;
  #refresh?: { generation: number; promise: Promise<StorageUsageResponse> };

  constructor(private readonly deps: StorageUsageServiceDeps) {}

  invalidate(): void {
    this.#cache = undefined;
    this.#generation += 1;
  }

  async computeUsage(force = false): Promise<StorageUsageResponse> {
    if (
      !force &&
      this.#cache &&
      Date.now() - this.#cache.at < USAGE_CACHE_TTL_MS
    ) {
      return this.#cache.value;
    }

    if (this.#refresh?.generation === this.#generation) {
      return this.#refresh.promise;
    }
    const generation = this.#generation;
    const promise = this.scanUsage().then((value) => {
      // An invalidated scan may finish for its callers, but must not repopulate
      // the cache or displace a newer refresh.
      if (generation === this.#generation) {
        this.#cache = { at: Date.now(), value };
      }
      return value;
    });
    const refresh = { generation, promise };
    this.#refresh = refresh;
    try {
      return await promise;
    } finally {
      if (this.#refresh === refresh) this.#refresh = undefined;
    }
  }

  private async scanUsage(): Promise<StorageUsageResponse> {
    const { paths } = this.deps;
    const totals = new Map<StorageCategoryKey, SizeTally>();
    const add = (key: StorageCategoryKey, tally: SizeTally) => {
      const current = totals.get(key) ?? { bytes: 0, files: 0 };
      totals.set(key, {
        bytes: current.bytes + tally.bytes,
        files: current.files + tally.files,
      });
    };

    const databaseSizes = await Promise.all(
      sqliteFilePaths(paths.sqlitePath).map(fileSize),
    );
    const database = {
      dbBytes: databaseSizes[0] ?? 0,
      walBytes: databaseSizes[1] ?? 0,
      shmBytes: databaseSizes[2] ?? 0,
    };
    const databaseTally = databaseSizes.reduce<SizeTally>(
      (total, size) => ({
        bytes: total.bytes + (size ?? 0),
        files: total.files + (size === undefined ? 0 : 1),
      }),
      { bytes: 0, files: 0 },
    );
    const conversationUsage = await scanDirectoryUsage(paths.conversationsPath);

    add("database", databaseTally);
    add("payloads", conversationUsage);
    add("images", await dirSize(paths.imagesPath));
    add("plans", await dirSize(paths.plansPath));
    add("agentResources", await dirSize(paths.agentPath));
    const logUsage = await scanDirectoryUsage(paths.logsPath);
    add("logs", logUsage);
    add("crashReports", await dirSize(paths.crashesPath));
    add("cache", await dirSize(paths.cachePath));
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
      basename(paths.conversationsPath),
      basename(paths.imagesPath),
      basename(paths.plansPath),
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

    const conversationSizes = [...conversationUsage.directories].map(
      ([name, tally]) => ({
        id: managedOwnerId(name, "conv_"),
        bytes: tally.bytes,
      }),
    );
    const conversations = this.deps.getSource().listConversations();
    const titleById = new Map(
      conversations.map((item) => [item.id, item.title]),
    );
    conversationSizes.sort((left, right) => right.bytes - left.bytes);
    const largest: LargestConversationUsage[] = conversationSizes
      .slice(0, LARGEST_CONVERSATION_LIMIT)
      .map((item) => ({
        conversationId: item.id,
        title: titleById.get(item.id) ?? null,
        bytes: item.bytes,
      }));

    const cleanupTargets = this.cleanupTargetUsage(
      totals,
      conversations.length,
      logUsage.rootFiles,
    );
    const value: StorageUsageResponse = {
      homeDir: paths.home,
      archivedHomeDir: await readArchivedHome(paths.home),
      generatedAt: new Date().toISOString(),
      totalBytes,
      categories,
      cleanupTargets,
      database,
      conversations: { total: conversationSizes.length, largest },
    };
    return value;
  }

  private cleanupTargetUsage(
    totals: Map<StorageCategoryKey, SizeTally>,
    conversationCount: number,
    logFiles: ReadonlyMap<string, number | undefined>,
  ): StorageCleanupTargetUsage[] {
    let datedBytes = 0;
    let datedItems = 0;
    for (const [name, size] of logFiles) {
      if (!DATED_LOG.test(name)) continue;
      datedBytes += size ?? 0;
      datedItems += 1;
    }
    const category = (key: StorageCategoryKey): SizeTally =>
      totals.get(key) ?? { bytes: 0, files: 0 };
    const rotatedBytes = logFiles.get("events.jsonl.1") ?? 0;
    return [
      {
        target: "conversations",
        bytes: category("payloads").bytes,
        itemCount: conversationCount,
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
    ];
  }
}
