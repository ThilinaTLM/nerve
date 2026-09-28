import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, realpath, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { DatabaseSync } from "node:sqlite";
import { storagePaths } from "../../packages/workbench-server/src/infrastructure/storage-bootstrap/paths.js";
import {
  atomicWriteJson,
  pathExists,
} from "../../packages/workbench-server/src/infrastructure/storage-bootstrap/json.js";
import { acquireStorageHomeLock } from "../../packages/workbench-server/src/infrastructure/storage-migrations/runner/home-lock.js";
import {
  assertDisposableHomePath,
  readStorageHomeClass,
} from "../../packages/workbench-server/src/infrastructure/storage-migrations/runner/home-class.js";
import { executeStorageMigrations } from "../../packages/workbench-server/src/infrastructure/storage-migrations/runner/executor.js";
import { canonicalPayloadSweepDescriptors } from "../../packages/workbench-server/src/infrastructure/storage-migrations/runner/payload-sweep.js";
import { planStorageMigration } from "../../packages/workbench-server/src/infrastructure/storage-migrations/runner/planner.js";
import { promoteStorageMigrationWorkspace } from "../../packages/workbench-server/src/infrastructure/storage-migrations/runner/promotion.js";
import { sweepStorageReadability } from "../../packages/workbench-server/src/infrastructure/storage-migrations/runner/sweep.js";
import { STORAGE_MIGRATION_REGISTRY_METADATA } from "../../packages/workbench-server/src/infrastructure/storage-migrations/steps/registry-metadata.js";
import {
  createStorageMigrationWorkspace,
  type StorageMigrationWorkspace,
} from "../../packages/workbench-server/src/infrastructure/storage-migrations/runner/workspace.js";

const registry = STORAGE_MIGRATION_REGISTRY_METADATA;
const defaultHome = join(homedir(), ".nerve");

export interface DryRunResult {
  outcome: string;
  appliedIds: string[];
  adoptedIds: string[];
  quarantinedIds: string[];
  sweepFailures: number;
  durationMs: number;
}

export async function cloneNerveHome(input: {
  source: string;
  destination: string;
}): Promise<void> {
  const requestedSource = resolve(input.source);
  const destination = resolve(input.destination);
  await assertDisposableHomePath(destination);
  if (!(await pathExists(requestedSource)))
    throw new Error(`Source home does not exist: ${requestedSource}`);
  const source = await realpath(requestedSource);
  if (!(await lstat(source)).isDirectory())
    throw new Error(`Source home is not a directory: ${source}`);
  await assertDistinctNonNestedPaths(source, destination);
  if (await pathExists(destination))
    throw new Error(`Clone destination already exists: ${destination}`);

  const sourcePaths = storagePaths(source);
  await readStorageHomeClass(sourcePaths.manifestPath);
  const lock = await acquireStorageHomeLock(source);
  try {
    if (await pathExists(sourcePaths.migrationPromotionJournalPath))
      throw new Error(
        "Source home has an interrupted storage promotion; start the owning build to recover it before cloning.",
      );
    await mkdir(dirname(destination), { recursive: true });
    const excluded = new Set([
      sourcePaths.backupsPath,
      sourcePaths.migrationWorkPath,
      sourcePaths.daemonPath,
    ]);
    await cp(source, destination, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
      filter(path) {
        const candidate = resolve(path);
        for (const excludedPath of excluded)
          if (isWithin(excludedPath, candidate)) return false;
        return true;
      },
    });
    await atomicWriteJson(
      join(destination, "manifest.json"),
      {
        format: "nerve-home",
        version: 2,
        homeClass: "disposable",
      },
      0o600,
    );
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  } finally {
    await lock.release();
  }
}

export async function dryRunNerveHomeMigration(input: {
  home: string;
  appVersion: string;
  buildId?: string;
  gitSha?: string;
  report?: (message: string) => void;
}): Promise<DryRunResult> {
  const home = resolve(input.home);
  await assertDisposableHomePath(home);
  const paths = storagePaths(home);
  if ((await readStorageHomeClass(paths.manifestPath)) !== "disposable")
    throw new Error("home:migrate --dry-run requires a disposable Nerve home.");
  if (await pathExists(paths.migrationPromotionJournalPath))
    throw new Error(
      "The home has an interrupted storage promotion; recover it before a dry run.",
    );

  const lock = await acquireStorageHomeLock(home);
  let workspace: StorageMigrationWorkspace | undefined;
  const startedAt = Date.now();
  try {
    const plan = planStorageMigration({
      sqlitePath: paths.sqlitePath,
      registry,
      buildId: input.buildId ?? `home-migrate-dry-run:${input.appVersion}`,
      homeClass: "disposable",
    });
    input.report?.(`plan: ${plan.outcome}`);
    if (["ahead", "invalid", "corrupt", "drift"].includes(plan.outcome))
      throw new Error(`Dry-run planning stopped with outcome: ${plan.outcome}`);
    if (plan.outcome === "current")
      return {
        outcome: plan.outcome,
        appliedIds: [],
        adoptedIds: [],
        quarantinedIds: [],
        sweepFailures: 0,
        durationMs: Date.now() - startedAt,
      };

    workspace = await createStorageMigrationWorkspace(paths);
    const execution = await executeStorageMigrations({
      paths,
      workspace,
      registry,
      appVersion: input.appVersion,
      ...(input.gitSha ? { gitSha: input.gitSha } : {}),
    });
    input.report?.(
      `workspace: applied=${execution.appliedIds.length} adopted=${execution.adoptedIds.length} quarantined=${execution.quarantinedIds.length}`,
    );
    const database = new DatabaseSync(workspace.sqlitePath, { readOnly: true });
    let sweepFailures: number;
    try {
      sweepFailures = sweepStorageReadability(
        database,
        canonicalPayloadSweepDescriptors(),
      ).failures.length;
    } finally {
      database.close();
    }
    input.report?.(`sweep: failures=${sweepFailures}`);
    return {
      outcome: plan.outcome,
      appliedIds: execution.appliedIds,
      adoptedIds: execution.adoptedIds,
      quarantinedIds: execution.quarantinedIds,
      sweepFailures,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await workspace?.discard();
    await lock.release();
  }
}

export async function restoreNerveHome(input: {
  home: string;
  snapshot: string;
  confirm?: (expected: string, warning: string) => Promise<string>;
  now?: () => Date;
}): Promise<{ exportedCurrentStorage: string }> {
  const home = resolve(input.home);
  const paths = storagePaths(home);
  await readStorageHomeClass(paths.manifestPath);
  const lock = await acquireStorageHomeLock(home);
  let workspace: StorageMigrationWorkspace | undefined;
  try {
    if (await pathExists(paths.migrationPromotionJournalPath))
      throw new Error(
        "The home has an interrupted storage promotion; start the owning build to recover it before restoring.",
      );
    const snapshot = await resolveSnapshot(
      paths.storageBackupsPath,
      input.snapshot,
    );
    const snapshotDatabase = join(snapshot, basename(paths.sqlitePath));
    const snapshotConfig = join(snapshot, "config");
    await assertRegularFile(snapshotDatabase, "snapshot database");
    if (!(await lstat(snapshotConfig).catch(() => undefined))?.isDirectory())
      throw new Error(
        `Snapshot config directory is missing: ${snapshotConfig}`,
      );

    const [snapshotStat, currentStat] = await Promise.all([
      stat(snapshotDatabase),
      stat(paths.sqlitePath),
    ]);
    const expected = `RESTORE ${basename(snapshot)}`;
    const warning = [
      `Restoring ${basename(snapshot)} may discard writes made after ${snapshotStat.mtime.toISOString()}.`,
      `Current database modified: ${currentStat.mtime.toISOString()}.`,
      "Current database and config will be exported to a new storage snapshot first.",
      `Type ${expected} to continue.`,
    ].join("\n");
    const answer = input.confirm
      ? await input.confirm(expected, warning)
      : await promptForConfirmation(expected, warning);
    if (answer !== expected)
      throw new Error("Restore cancelled: confirmation did not match.");

    workspace = await createStorageMigrationWorkspace(paths, {
      id: `restore-${Date.now()}-${randomUUID()}`,
    });
    await rm(workspace.sqlitePath, { force: true });
    await rm(workspace.configPath, { recursive: true, force: true });
    await cp(snapshotDatabase, workspace.sqlitePath, {
      errorOnExist: true,
      force: false,
    });
    await cp(snapshotConfig, workspace.configPath, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
    verifySqlite(workspace.sqlitePath);
    const result = await promoteStorageMigrationWorkspace(
      paths,
      workspace,
      `restore-${basename(snapshot)}`,
      input.now ? { now: input.now } : {},
    );
    workspace = undefined;
    return { exportedCurrentStorage: result.snapshotPath };
  } finally {
    await workspace?.discard();
    await lock.release();
  }
}

export function parseOptions(args: string[]): Map<string, string | true> {
  const result = new Map<string, string | true>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument?.startsWith("--"))
      throw new Error(`Unexpected argument: ${argument}`);
    if (argument === "--dry-run") {
      result.set(argument, true);
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${argument}`);
    result.set(argument, value);
    index += 1;
  }
  return result;
}

export function assertAllowedOptions(
  values: Map<string, string | true>,
  allowed: readonly string[],
): void {
  for (const name of values.keys())
    if (!allowed.includes(name)) throw new Error(`Unknown option ${name}`);
}

export function option(
  values: Map<string, string | true>,
  name: string,
  fallback?: string,
): string {
  const value = values.get(name) ?? fallback;
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`Missing required option ${name}`);
  return value;
}

export function defaultNerveHome(): string {
  return process.env.NERVE_HOME?.trim() || defaultHome;
}

async function resolveSnapshot(
  backupsRoot: string,
  value: string,
): Promise<string> {
  const root = await realpath(backupsRoot);
  const candidate = await realpath(
    isAbsolute(value) ? value : join(root, value),
  );
  const relativePath = relative(root, candidate);
  if (
    relativePath.startsWith("..") ||
    isAbsolute(relativePath) ||
    relativePath === ""
  )
    throw new Error(
      "Snapshot must be a child of the home's backups/storage directory.",
    );
  return candidate;
}

async function assertDistinctNonNestedPaths(
  source: string,
  destination: string,
) {
  const canonicalSource = await realpath(source).catch(() => source);
  const canonicalDestinationParent = await realpath(dirname(destination)).catch(
    () => dirname(destination),
  );
  const canonicalDestination = resolve(
    canonicalDestinationParent,
    basename(destination),
  );
  const fromSource = relative(canonicalSource, canonicalDestination);
  const fromDestination = relative(canonicalDestination, canonicalSource);
  if (
    fromSource === "" ||
    (!fromSource.startsWith("..") && !isAbsolute(fromSource)) ||
    (!fromDestination.startsWith("..") && !isAbsolute(fromDestination))
  )
    throw new Error(
      "Source and destination homes must not contain one another.",
    );
}

function isWithin(parent: string, candidate: string): boolean {
  const child = relative(parent, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

async function assertRegularFile(path: string, label: string) {
  if (!(await lstat(path).catch(() => undefined))?.isFile())
    throw new Error(`${label} is missing: ${path}`);
}

function verifySqlite(path: string) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const row = database.prepare("PRAGMA quick_check").get() as
      | { quick_check?: string }
      | undefined;
    if (row?.quick_check !== "ok")
      throw new Error("Snapshot database failed quick_check.");
  } finally {
    database.close();
  }
}

async function promptForConfirmation(expected: string, warning: string) {
  if (!stdin.isTTY || !stdout.isTTY)
    throw new Error(
      "Restore requires an interactive terminal for typed confirmation.",
    );
  console.error(warning);
  const reader = createInterface({ input: stdin, output: stdout });
  try {
    return await reader.question("> ");
  } finally {
    reader.close();
  }
}
