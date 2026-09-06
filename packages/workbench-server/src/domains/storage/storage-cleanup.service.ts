import { readdir, rmdir, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import type {
  StorageCleanupRequest,
  StorageCleanupResult,
  StorageCleanupTarget,
} from "@nervekit/contracts/storage";
import type { StoragePaths } from "../../infrastructure/storage-bootstrap/index.js";
import type { MaintenanceExecution } from "../maintenance/maintenance-execution.js";
import {
  dirSize,
  fileSize,
  pathsSize,
  queryCacheFileNames,
  queryCacheFilePaths,
} from "./storage-files.js";
import type { StorageUsageService } from "./storage-usage.service.js";
export interface StorageCleanupOperations {
  pruneConversationsAcrossProjects(
    request: { strategy: "olderThanDays"; olderThanDays: number },
    execution: MaintenanceExecution,
  ): Promise<{ removedConversationCount: number; skippedCount: number }>;
  rebuildSearchIndex(): Promise<void>;
}
export interface StorageCleanupExecutorDeps {
  paths: StoragePaths;
  usage: StorageUsageService;
  getOperations: () => StorageCleanupOperations;
}
interface TargetPlan {
  target: StorageCleanupTarget;
  message: string;
  run: () => Promise<Omit<StorageCleanupResult, "target" | "outcome">>;
}
export class StorageCleanupExecutor {
  constructor(private readonly deps: StorageCleanupExecutorDeps) {}
  async execute(
    request: StorageCleanupRequest,
    execution: MaintenanceExecution,
  ): Promise<void> {
    const plans = this.targetPlans(request, execution);
    const targets: StorageCleanupResult[] = [];
    let freedBytes = 0;
    await execution.report({ totalTargets: plans.length });
    for (const plan of plans) {
      if (execution.cancelled()) {
        targets.push({
          target: plan.target,
          outcome: "cancelled",
          freedBytes: 0,
          removedItems: 0,
          skipped: 0,
          note: "Stopped before this target started.",
        });
        continue;
      }
      await execution.report({
        phase: plan.target,
        message: plan.message,
        currentTarget: plan.target,
        cancellable: plan.target !== "searchIndex",
      });
      let result: StorageCleanupResult;
      try {
        result = {
          target: plan.target,
          outcome: "succeeded",
          ...(await plan.run()),
        };
      } catch (error) {
        result = {
          target: plan.target,
          outcome: "failed",
          freedBytes: 0,
          removedItems: 0,
          skipped: 1,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      if (execution.cancelled() && result.outcome === "succeeded")
        result.outcome = "cancelled";
      targets.push(result);
      freedBytes += result.freedBytes;
      this.deps.usage.invalidate();
      await execution.report({
        completedTargets: targets.length,
        freedBytes,
        currentTarget: undefined,
        currentItem: undefined,
        cancellable: true,
        result: { kind: "storage_cleanup", targets: [...targets] },
        warnings: targets.flatMap((target) =>
          target.error
            ? [target.error]
            : target.skipped
              ? [
                  target.note ??
                    `${target.skipped} ${target.target} items were skipped.`,
                ]
              : [],
        ),
      });
    }
    await execution.report({
      phase: "finalizing",
      message: "Finalizing cleanup…",
      result: { kind: "storage_cleanup", targets },
      currentTarget: undefined,
    });
    this.deps.usage.invalidate();
  }
  private targetPlans(
    request: StorageCleanupRequest,
    execution: MaintenanceExecution,
  ): TargetPlan[] {
    const plans: TargetPlan[] = [];
    if (request.conversationsOlderThanDays !== undefined) {
      plans.push({
        target: "conversations",
        message: "Removing old inactive conversations…",
        run: async () => {
          const dir = this.deps.paths.conversationsPath;
          const before = (await dirSize(dir)).bytes;
          const result = await this.deps
            .getOperations()
            .pruneConversationsAcrossProjects(
              {
                strategy: "olderThanDays",
                olderThanDays: request.conversationsOlderThanDays as number,
              },
              execution,
            );
          const after = (await dirSize(dir)).bytes;
          return {
            freedBytes: Math.max(0, before - after),
            removedItems: result.removedConversationCount,
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
        run: () =>
          this.pruneDatedLogs(execution, request.logsOlderThanDays as number),
      });
    }
    if (request.truncateEventLog) {
      plans.push({
        target: "rotatedEventLog",
        message: "Removing the rotated event log…",
        run: () =>
          this.removeFile(join(this.deps.paths.logsPath, "events.jsonl.1")),
      });
    }
    if (request.clearExploreReports)
      plans.push({
        target: "exploreReports",
        message: "Clearing explore reports…",
        run: () =>
          this.clearDirContents(execution, this.deps.paths.reportsPath),
      });
    if (request.clearCrashReports)
      plans.push({
        target: "crashReports",
        message: "Clearing crash reports…",
        run: () =>
          this.clearDirContents(execution, this.deps.paths.crashesPath),
      });
    if (request.clearCache)
      plans.push({
        target: "cache",
        message: "Clearing cached data…",
        run: () =>
          this.clearDirContents(
            execution,
            this.deps.paths.cachePath,
            queryCacheFileNames(this.deps.paths.queryCachePath),
            true,
          ),
      });
    if (request.clearTmp)
      plans.push({
        target: "tmp",
        message: "Clearing temporary files…",
        run: () => this.clearDirContents(execution, this.deps.paths.tmpPath),
      });
    if (request.rebuildSearchIndex) {
      plans.push({
        target: "searchIndex",
        message: "Rebuilding the search index…",
        run: async () => {
          const before = await this.indexFootprint();
          await this.deps.getOperations().rebuildSearchIndex();
          const after = await this.indexFootprint();
          return {
            freedBytes: Math.max(0, before - after),
            removedItems: 0,
            skipped: 0,
            note: "Rebuilt from canonical records.",
          };
        },
      });
    }
    return plans;
  }

  private async pruneDatedLogs(
    execution: MaintenanceExecution,
    olderThanDays: number,
  ): Promise<Omit<StorageCleanupResult, "target" | "outcome">> {
    const logsDir = this.deps.paths.logsPath;
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const datedLog = /^(application|desktop)-(\d{4}-\d{2}-\d{2})\.jsonl$/;
    const files = await readdir(logsDir).catch(() => []);
    let freedBytes = 0;
    let removedItems = 0;
    let skipped = 0;
    for (const file of files) {
      if (execution.cancelled()) break;
      const match = datedLog.exec(file);
      if (!match || (match[2] as string) >= cutoff) continue;
      const path = join(logsDir, file);
      const bytes = (await fileSize(path)) ?? 0;
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
    if (bytes === undefined)
      return { freedBytes: 0, removedItems: 0, skipped: 0 };
    await unlink(path);
    return { freedBytes: bytes, removedItems: 1, skipped: 0 };
  }

  private async clearDirContents(
    execution: MaintenanceExecution,
    path: string,
    excludedNames: ReadonlySet<string> = new Set(),
    preserveRoot = false,
  ): Promise<Omit<StorageCleanupResult, "target" | "outcome">> {
    const entries = await readdir(path, { withFileTypes: true }).catch(
      () => [],
    );
    let freedBytes = 0;
    let removedItems = 0;
    let skipped = 0;
    for (const entry of entries) {
      if (execution.cancelled()) break;
      if (excludedNames.has(entry.name)) continue;
      if (entry.isSymbolicLink()) {
        skipped += 1;
        continue;
      }
      const child = join(path, entry.name);
      const bytes = entry.isDirectory()
        ? (await dirSize(child)).bytes
        : ((await fileSize(child)) ?? 0);
      try {
        await rm(child, { recursive: true, force: true });
        freedBytes += bytes;
        removedItems += 1;
      } catch {
        skipped += 1;
      }
    }
    if (preserveRoot) return { freedBytes, removedItems, skipped };
    await rmdir(path).catch((error: unknown) => {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : undefined;
      if (code !== "ENOENT" && code !== "ENOTEMPTY" && code !== "EEXIST")
        throw error;
    });
    return { freedBytes, removedItems, skipped };
  }

  private async indexFootprint(): Promise<number> {
    return (
      await pathsSize(queryCacheFilePaths(this.deps.paths.queryCachePath))
    ).bytes;
  }
}
