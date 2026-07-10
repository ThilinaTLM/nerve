import { mkdir, readdir, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  createId,
  type StorageCleanupOperation,
  type StorageCleanupRequest,
  type StorageCleanupResult,
  type StorageCleanupTarget,
} from "@nervekit/contracts";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { StoragePaths } from "../../infrastructure/storage/index.js";
import type { StorageCleanupRepository } from "./storage-cleanup.repository.js";
import { dirSize, fileSize } from "./storage-files.js";
import type { StorageUsageService } from "./storage-usage.service.js";

export interface StorageCleanupRegistryPort {
  pruneConversationsAcrossProjects(request: {
    strategy: "olderThanDays";
    olderThanDays: number;
  }): Promise<{ prunedConversationIds: string[]; skippedCount: number }>;
  rebuildSearchIndex(): Promise<void>;
  tools: {
    compactToolCallLog(): Promise<void>;
    toolCallLogPath(): string;
  };
}

export interface StorageCleanupServiceDeps {
  paths: StoragePaths;
  repository: StorageCleanupRepository;
  usage: StorageUsageService;
  events: EventBus;
  logger: ApplicationLogger;
  getRegistry: () => StorageCleanupRegistryPort;
}

interface TargetPlan {
  target: StorageCleanupTarget;
  message: string;
  run: () => Promise<Omit<StorageCleanupResult, "target" | "outcome">>;
}

const ACTIVE_STATUSES = new Set(["queued", "running", "cancelling"]);

export class StorageCleanupService {
  #operation: StorageCleanupOperation | null = null;
  #execution?: Promise<void>;
  #shuttingDown = false;

  constructor(private readonly deps: StorageCleanupServiceDeps) {}

  async hydrate(): Promise<void> {
    this.#operation = await this.deps.repository.read();
    if (this.#operation && ACTIVE_STATUSES.has(this.#operation.status)) {
      await this.update({
        ...this.#operation,
        status: "failed",
        cancellable: false,
        cancellationRequested: false,
        completedAt: new Date().toISOString(),
        message: "Cleanup was interrupted when the daemon stopped.",
        error: "The daemon stopped before cleanup completed.",
      });
    }
  }

  get(operationId?: string): StorageCleanupOperation | null {
    if (!this.#operation) return null;
    if (operationId && operationId !== this.#operation.id) return null;
    return this.#operation;
  }

  async start(
    request: StorageCleanupRequest,
  ): Promise<StorageCleanupOperation> {
    if (this.#shuttingDown) throw new Error("The daemon is shutting down.");
    if (this.#operation && ACTIVE_STATUSES.has(this.#operation.status)) {
      throw new Error("A storage cleanup is already in progress.");
    }
    const totalTargets = requestTargets(request).length;
    const operation: StorageCleanupOperation = {
      id: createId("storageop"),
      request,
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      message: "Cleanup is queued.",
      completedTargets: 0,
      totalTargets,
      cancellable: true,
      cancellationRequested: false,
      freedBytes: 0,
      results: [],
    };
    await this.update(operation);
    this.#execution = new Promise<void>((resolve) => {
      setImmediate(() => {
        void this.execute(operation.id).finally(resolve);
      });
    }).finally(() => {
      this.#execution = undefined;
    });
    return operation;
  }

  async cancel(operationId: string): Promise<StorageCleanupOperation> {
    const operation = this.get(operationId);
    if (!operation) throw new Error("Storage cleanup operation not found.");
    if (!ACTIVE_STATUSES.has(operation.status)) return operation;
    if (!operation.cancellable) {
      throw new Error(
        "The search index replacement cannot be interrupted safely.",
      );
    }
    return this.update({
      ...operation,
      status: "cancelling",
      cancellationRequested: true,
      message: operation.currentTarget
        ? `Stopping after ${targetLabel(operation.currentTarget)}…`
        : "Cancelling cleanup…",
    });
  }

  async shutdown(): Promise<void> {
    this.#shuttingDown = true;
    if (
      this.#operation &&
      ACTIVE_STATUSES.has(this.#operation.status) &&
      this.#operation.cancellable
    ) {
      await this.cancel(this.#operation.id).catch(() => undefined);
    }
    await this.#execution;
  }

  private async execute(operationId: string): Promise<void> {
    const queued = this.get(operationId);
    if (!queued) return;
    try {
      await this.update({
        ...queued,
        status: queued.cancellationRequested ? "cancelling" : "running",
        startedAt: new Date().toISOString(),
        message: queued.cancellationRequested
          ? "Cancelling cleanup…"
          : "Preparing cleanup…",
      });
      const plans = this.targetPlans(queued.request);
      for (let index = 0; index < plans.length; index += 1) {
        const current = this.get(operationId);
        if (!current) return;
        if (current.cancellationRequested || this.#shuttingDown) {
          await this.finishCancelled(current, plans.slice(index));
          return;
        }
        const plan = plans[index] as TargetPlan;
        await this.update({
          ...current,
          status: "running",
          currentTarget: plan.target,
          message: plan.message,
          cancellable: plan.target !== "searchIndex",
        });
        const result = await this.runTarget(plan);
        this.deps.usage.invalidate();
        const after = this.get(operationId);
        if (!after) return;
        await this.update({
          ...after,
          status: after.cancellationRequested ? "cancelling" : "running",
          currentTarget: undefined,
          message: after.cancellationRequested
            ? `Stopping after ${targetLabel(plan.target)}…`
            : `${targetLabel(plan.target)} complete.`,
          completedTargets: after.completedTargets + 1,
          cancellable: true,
          freedBytes: after.freedBytes + result.freedBytes,
          results: [...after.results, result],
        });
      }

      const beforeScan = this.get(operationId);
      if (!beforeScan) return;
      if (beforeScan.cancellationRequested || this.#shuttingDown) {
        await this.finishCancelled(beforeScan, []);
        return;
      }
      await this.update({
        ...beforeScan,
        message: "Recalculating storage…",
        cancellable: true,
      });
      const usage = await this.deps.usage.computeUsage(true);
      const final = this.get(operationId);
      if (!final) return;
      await this.update({
        ...final,
        status: "succeeded",
        completedAt: new Date().toISOString(),
        currentTarget: undefined,
        message: final.results.some((result) => result.outcome === "failed")
          ? "Cleanup completed with issues."
          : "Cleanup complete.",
        cancellable: false,
        cancellationRequested: false,
        usage,
      });
    } catch (error) {
      const current = this.get(operationId);
      if (!current) return;
      const message = error instanceof Error ? error.message : String(error);
      await this.update({
        ...current,
        status: "failed",
        completedAt: new Date().toISOString(),
        currentTarget: undefined,
        message: "Cleanup failed.",
        cancellable: false,
        error: message,
      }).catch(() => undefined);
      await this.deps.logger
        .warn("Storage cleanup failed", { error })
        .catch(() => undefined);
    }
  }

  private async finishCancelled(
    operation: StorageCleanupOperation,
    remaining: TargetPlan[],
  ): Promise<void> {
    const cancelledResults: StorageCleanupResult[] = remaining.map((plan) => ({
      target: plan.target,
      outcome: "cancelled",
      freedBytes: 0,
      removedItems: 0,
      skipped: 0,
      note: "Cancelled before this target started.",
    }));
    let usage = operation.usage;
    try {
      usage = await this.deps.usage.computeUsage(true);
    } catch {
      // Keep completed cleanup results even if the follow-up scan fails.
    }
    await this.update({
      ...operation,
      status: "cancelled",
      completedAt: new Date().toISOString(),
      currentTarget: undefined,
      message: "Cleanup cancelled.",
      cancellable: false,
      cancellationRequested: false,
      results: [...operation.results, ...cancelledResults],
      usage,
    });
  }

  private async runTarget(plan: TargetPlan): Promise<StorageCleanupResult> {
    try {
      return {
        target: plan.target,
        outcome: "succeeded",
        ...(await plan.run()),
      };
    } catch (error) {
      return {
        target: plan.target,
        outcome: "failed",
        freedBytes: 0,
        removedItems: 0,
        skipped: 1,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private targetPlans(request: StorageCleanupRequest): TargetPlan[] {
    const plans: TargetPlan[] = [];
    if (request.conversationsOlderThanDays !== undefined) {
      plans.push({
        target: "conversations",
        message: "Removing old inactive conversations…",
        run: async () => {
          const dir = join(this.deps.paths.home, "conversations");
          const before = (await dirSize(dir)).bytes;
          const result = await this.deps
            .getRegistry()
            .pruneConversationsAcrossProjects({
              strategy: "olderThanDays",
              olderThanDays: request.conversationsOlderThanDays as number,
            });
          const after = (await dirSize(dir)).bytes;
          return {
            freedBytes: Math.max(0, before - after),
            removedItems: result.prunedConversationIds.length,
            skipped: result.skippedCount,
            note:
              result.skippedCount > 0
                ? `${result.skippedCount} active conversations were kept.`
                : undefined,
          };
        },
      });
    }
    if (request.logsOlderThanDays !== undefined) {
      plans.push({
        target: "datedLogs",
        message: "Removing old dated logs…",
        run: () => this.pruneDatedLogs(request.logsOlderThanDays as number),
      });
    }
    if (request.truncateEventLog) {
      plans.push({
        target: "rotatedEventLog",
        message: "Removing the rotated event log…",
        run: () =>
          this.removeFile(join(this.deps.paths.home, "logs", "events.jsonl.1")),
      });
    }
    if (request.clearToolCallLog) {
      plans.push({
        target: "toolCallLog",
        message: "Compacting tool-call history…",
        run: async () => {
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
        },
      });
    }
    if (request.clearExploreReports)
      plans.push({
        target: "exploreReports",
        message: "Clearing explore reports…",
        run: () =>
          this.clearDirContents(join(this.deps.paths.home, "explore-reports")),
      });
    if (request.clearCache)
      plans.push({
        target: "cache",
        message: "Clearing cached data…",
        run: () => this.clearDirContents(join(this.deps.paths.home, "cache")),
      });
    if (request.clearTmp)
      plans.push({
        target: "tmp",
        message: "Clearing temporary files…",
        run: () => this.clearDirContents(join(this.deps.paths.home, "tmp")),
      });
    if (request.rebuildSearchIndex) {
      plans.push({
        target: "searchIndex",
        message: "Rebuilding the search index…",
        run: async () => {
          const before = await this.indexFootprint();
          await this.deps.getRegistry().rebuildSearchIndex();
          const after = await this.indexFootprint();
          return {
            freedBytes: Math.max(0, before - after),
            removedItems: 0,
            skipped: 0,
            note: "Rebuilt from current records and retained event logs.",
          };
        },
      });
    }
    return plans;
  }

  private async pruneDatedLogs(
    olderThanDays: number,
  ): Promise<Omit<StorageCleanupResult, "target" | "outcome">> {
    const logsDir = join(this.deps.paths.home, "logs");
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const datedLog = /^(application|desktop)-(\d{4}-\d{2}-\d{2})\.jsonl$/;
    const files = await readdir(logsDir).catch(() => []);
    let freedBytes = 0;
    let removedItems = 0;
    let skipped = 0;
    for (const file of files) {
      const match = datedLog.exec(file);
      if (!match || (match[2] as string) >= cutoff) continue;
      const path = join(logsDir, file);
      const bytes = await fileSize(path);
      try {
        await unlink(path);
        freedBytes += bytes;
        removedItems += 1;
      } catch {
        skipped += 1;
      }
    }
    return { freedBytes, removedItems, skipped };
  }

  private async removeFile(
    path: string,
  ): Promise<Omit<StorageCleanupResult, "target" | "outcome">> {
    const bytes = await fileSize(path);
    if (bytes === 0) return { freedBytes: 0, removedItems: 0, skipped: 0 };
    await unlink(path);
    return { freedBytes: bytes, removedItems: 1, skipped: 0 };
  }

  private async clearDirContents(
    path: string,
  ): Promise<Omit<StorageCleanupResult, "target" | "outcome">> {
    const entries = await readdir(path, { withFileTypes: true }).catch(
      () => [],
    );
    let freedBytes = 0;
    let removedItems = 0;
    let skipped = 0;
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        skipped += 1;
        continue;
      }
      const child = join(path, entry.name);
      const bytes = entry.isDirectory()
        ? (await dirSize(child)).bytes
        : await fileSize(child);
      try {
        await rm(child, { recursive: true, force: true });
        freedBytes += bytes;
        removedItems += 1;
      } catch {
        skipped += 1;
      }
    }
    await mkdir(path, { recursive: true });
    return { freedBytes, removedItems, skipped };
  }

  private async indexFootprint(): Promise<number> {
    return (
      (await fileSize(this.deps.paths.sqlitePath)) +
      (await fileSize(`${this.deps.paths.sqlitePath}-wal`)) +
      (await fileSize(`${this.deps.paths.sqlitePath}-shm`))
    );
  }

  private async update(
    operation: StorageCleanupOperation,
  ): Promise<StorageCleanupOperation> {
    const updated = { ...operation, updatedAt: new Date().toISOString() };
    await this.deps.repository.write(updated);
    this.#operation = updated;
    await this.deps.events.publish(
      "storage.cleanup.updated",
      { operation: updated },
      { durability: "transient" },
    );
    return updated;
  }
}

function requestTargets(
  request: StorageCleanupRequest,
): StorageCleanupTarget[] {
  const targets: StorageCleanupTarget[] = [];
  if (request.conversationsOlderThanDays !== undefined)
    targets.push("conversations");
  if (request.logsOlderThanDays !== undefined) targets.push("datedLogs");
  if (request.truncateEventLog) targets.push("rotatedEventLog");
  if (request.clearToolCallLog) targets.push("toolCallLog");
  if (request.clearExploreReports) targets.push("exploreReports");
  if (request.clearCache) targets.push("cache");
  if (request.clearTmp) targets.push("tmp");
  if (request.rebuildSearchIndex) targets.push("searchIndex");
  return targets;
}

function targetLabel(target: StorageCleanupTarget): string {
  return (
    {
      conversations: "old conversations",
      datedLogs: "dated logs",
      rotatedEventLog: "rotated event log",
      toolCallLog: "tool-call log",
      exploreReports: "explore reports",
      cache: "cache",
      tmp: "temporary files",
      searchIndex: "search index",
    } satisfies Record<StorageCleanupTarget, string>
  )[target];
}
