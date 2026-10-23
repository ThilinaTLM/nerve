import { syncDirectory, syncFile } from "./durability.js";
import { existsSync } from "node:fs";
import { RollbackJournal } from "./rollback-journal.js";
import { copyFile, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { atomicWriteJson, pathExists } from "../../storage-bootstrap/json.js";
import {
  storagePaths,
  type StoragePaths,
} from "../../storage-bootstrap/paths.js";
import {
  acquireStorageHomeLock,
  type StorageHomeLock,
} from "../../storage-bootstrap/home-lock.js";
import { MIGRATION_REGISTRY } from "../steps/index.js";
import {
  createStepContext,
  discardedItemsPath,
  readDiscardedItems,
} from "./context.js";
import { planMigrations, readMigrationHome } from "./ledger.js";
import type { DiscardableItem, RegisteredStep } from "./step.js";
import { manifestBackupPath } from "./cleanup.js";
export { manifestBackupPath } from "./cleanup.js";

/** Persisted by the runner after a failed attempt; read by startup and recovery. */
export interface MigrationFailureReport {
  step: string | null;
  phase: string;
  error: string;
  failedAt: string;
  /** Set when only these units failed; they may be discarded. */
  discardable?: DiscardableItem[];
  /** Whether the failed step can still restore the previous version's home. */
  rollbackAvailable?: boolean;
}

export async function readMigrationFailureReport(
  paths: StoragePaths,
): Promise<MigrationFailureReport | undefined> {
  try {
    return JSON.parse(
      await readFile(paths.migrationFailureReportPath, "utf8"),
    ) as MigrationFailureReport;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

interface RecoveryOptions {
  /** Caller-held lock; otherwise the home lock is acquired without waiting. */
  lock?: StorageHomeLock;
  registry?: readonly RegisteredStep[];
}

async function withHomeLock<T>(
  home: string,
  options: RecoveryOptions,
  action: () => Promise<T>,
): Promise<T> {
  if (options.lock && options.lock.path !== `${home}.startup.lock`)
    throw new Error("Migration lock does not belong to this home.");
  const lock =
    options.lock ?? (await acquireStorageHomeLock(home, { timeoutMs: 0 }));
  try {
    return await action();
  } finally {
    if (!options.lock) await lock.release();
  }
}

/**
 * Records the user's decision to discard units reported by the last failed
 * attempt. The next migration attempt runs without them.
 */
export async function discardFailedItems(
  home: string,
  ids: readonly string[],
  options: RecoveryOptions = {},
): Promise<void> {
  await withHomeLock(home, options, async () => {
    const paths = storagePaths(home);
    const report = await readMigrationFailureReport(paths);
    const failed = new Set(report?.discardable?.map(({ id }) => id) ?? []);
    if (!report?.step || !failed.size)
      throw new Error("The last upgrade attempt reported nothing to discard.");
    const unknown = ids.filter((id) => !failed.has(id));
    if (!ids.length || unknown.length)
      throw new Error(
        `Only items reported by the last upgrade attempt can be discarded${unknown.length ? `: ${unknown.join(", ")}` : ""}.`,
      );
    const scratchDir = join(paths.migrationWorkPath, report.step);
    const dependencyPath = join(scratchDir, "unit-dependencies.json");
    const dependencies: Record<string, string[]> = (await pathExists(
      dependencyPath,
    ))
      ? JSON.parse(await readFile(dependencyPath, "utf8"))
      : {};
    const chosen = new Set(ids);
    for (const id of chosen)
      for (const child of dependencies[id] ?? [])
        if (failed.has(child)) chosen.add(child);
    const discarded = readDiscardedItems(scratchDir);
    const detailsPath = join(scratchDir, "discarded-details.json");
    const details: DiscardableItem[] = (await pathExists(detailsPath))
      ? JSON.parse(await readFile(detailsPath, "utf8"))
      : [];
    for (const item of report.discardable ?? [])
      if (chosen.has(item.id) && !details.some((saved) => saved.id === item.id))
        details.push(item);
    await atomicWriteJson(detailsPath, details, 0o600);
    for (const id of chosen) discarded.add(id);
    await atomicWriteJson(
      discardedItemsPath(scratchDir),
      [...discarded].sort(),
      0o600,
    );
  });
}

/**
 * Restores the home to its state before the failed step: the step undoes its
 * own changes, then the original manifest returns. Only an unrecorded step whose
 * rollback is still available (per the failure report) can be rolled back.
 */
export async function rollbackFailedMigration(
  home: string,
  options: RecoveryOptions = {},
): Promise<void> {
  await withHomeLock(home, options, async () => {
    const paths = storagePaths(home);
    const report = await readMigrationFailureReport(paths);
    if (!report?.step || !report.rollbackAvailable)
      throw new Error("The failed upgrade cannot be rolled back.");
    const registry = options.registry ?? MIGRATION_REGISTRY;
    const { manifest } = await readMigrationHome(paths);
    const entry = planMigrations(manifest, registry)[0];
    if (entry?.step.id !== report.step)
      throw new Error(`Upgrade step ${report.step} is not pending.`);
    const { context } = createStepContext(
      paths,
      entry.step.id,
      entry.step.description,
      () => undefined,
    );
    if (existsSync(join(context.scratchDir, "verified.json")))
      throw new Error("The failed upgrade cannot be rolled back.");
    // Custom rollback must validate its committed SQL/file candidate before the
    // generic journal removes exports that are part of that validation.
    await entry.step.rollback?.(context);
    if (existsSync(join(context.scratchDir, "rollback")))
      new RollbackJournal(context.scratchDir).restore();
    const baselineBackup = manifestBackupPath(paths);
    const restoredMarker = join(context.scratchDir, "manifest-restored.json");
    if (!(await pathExists(restoredMarker))) {
      const backup =
        !manifest.migrations?.length && (await pathExists(baselineBackup))
          ? baselineBackup
          : join(context.scratchDir, "manifest.before.json");
      if (!(await pathExists(backup)))
        throw new Error("Missing pre-step manifest rollback snapshot.");
      const temporary = `${paths.manifestPath}.rollback`;
      await copyFile(backup, temporary);
      syncFile(temporary);
      await rename(temporary, paths.manifestPath);
      syncDirectory(dirname(paths.manifestPath));
      // Keep the chosen bytes until this marker is durable. In particular, a
      // resumed baseline rollback must never fall back to the admitted ledger.
      await atomicWriteJson(restoredMarker, {}, 0o600);
    }
    await rm(baselineBackup, { force: true });
    await rm(context.scratchDir, { recursive: true, force: true });
    await rm(join(paths.migrationWorkPath, "cleanup-needed.json"), {
      force: true,
    });
    await rm(paths.migrationFailureReportPath, { force: true });
  });
}
