import { mkdir, rm } from "node:fs/promises";
import { atomicWriteJson } from "../../storage-bootstrap/json.js";
import { storagePaths } from "../../storage-bootstrap/paths.js";
import {
  acquireStorageHomeLock,
  type StorageHomeLock,
} from "../../storage-bootstrap/home-lock.js";
import { MIGRATION_REGISTRY } from "../steps/index.js";
import { assertFreeDisk, createStepContext } from "./context.js";
import {
  planMigrations,
  readMigrationHome,
  recordMigration,
} from "./ledger.js";
import {
  validateRegistry,
  type MigrationProgress,
  type RegisteredStep,
} from "./step.js";

export interface MigrationOptions {
  dryRun?: boolean;
  freshHomeClass?: "standard" | "disposable";
  /** Caller must retain this lock until storage has opened / daemon is published. */
  lock?: StorageHomeLock;
  onProgress?: (progress: MigrationProgress) => void;
  registry?: readonly RegisteredStep[];
}

export async function runMigrations(
  home: string,
  options: MigrationOptions = {},
): Promise<{ fresh: boolean; pending: string[] }> {
  if (options.lock && options.lock.path !== `${home}.startup.lock`)
    throw new Error("Migration lock does not belong to this home.");
  const lock =
    options.lock ?? (await acquireStorageHomeLock(home, { timeoutMs: 0 }));
  const paths = storagePaths(home);
  let stepId: string | null = null;
  let phase = "plan";
  try {
    const registry = options.registry ?? MIGRATION_REGISTRY;
    validateRegistry(registry);
    const { fresh, manifest } = await readMigrationHome(paths);
    const pending = fresh ? [] : planMigrations(manifest, registry);
    const result = { fresh, pending: pending.map(({ step }) => step.id) };
    if (options.dryRun) return result;
    if (fresh) {
      await atomicWriteJson(
        paths.manifestPath,
        {
          ...manifest,
          homeClass: options.freshHomeClass ?? "standard",
          migrations: registry.map((entry) => ({
            id: entry.step.id,
            checksum: entry.checksum,
            appliedAt: new Date().toISOString(),
          })),
        },
        0o600,
      );
    }
    // Admit the baseline before a step can replace/delete its old DB.
    if (!fresh && !manifest.migrations) {
      await atomicWriteJson(
        paths.manifestPath,
        { ...manifest, migrations: [] },
        0o600,
      );
    }
    // Recover cleanup after a crash between ledger append and scratch removal.
    for (const applied of manifest.migrations ?? []) {
      await rm(`${paths.migrationWorkPath}/${applied.id}`, {
        recursive: true,
        force: true,
      });
    }
    for (const entry of pending) {
      stepId = entry.step.id;
      phase = "disk-check";
      if (entry.step.requiresFreeBytes !== undefined)
        await assertFreeDisk(home, entry.step.requiresFreeBytes);
      const { context, flushLog } = createStepContext(
        paths,
        stepId,
        (progress) => {
          phase = progress.phase;
          options.onProgress?.(progress);
        },
      );
      await mkdir(context.scratchDir, { recursive: true, mode: 0o700 });
      try {
        context.progress("run");
        await entry.step.run(context);
        context.progress("verify");
        await entry.step.verify?.(context);
        await flushLog();
        context.progress("ledger");
        await recordMigration(paths, entry);
      } finally {
        await flushLog();
      }
      phase = "cleanup";
      await rm(context.scratchDir, { recursive: true, force: true });
    }
    await rm(paths.migrationFailureReportPath, { force: true });
    return result;
  } catch (error) {
    if (!options.dryRun) {
      await atomicWriteJson(
        paths.migrationFailureReportPath,
        {
          step: stepId,
          phase,
          error:
            error instanceof Error
              ? (error.stack ?? error.message)
              : String(error),
          failedAt: new Date().toISOString(),
        },
        0o600,
      );
    }
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${options.dryRun ? "" : `\nMigration failure report: ${paths.migrationFailureReportPath}`}`,
      { cause: error },
    );
  } finally {
    if (!options.lock) await lock.release();
  }
}
