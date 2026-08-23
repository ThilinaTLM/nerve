import { lstat, mkdir, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import {
  daemonFileSchema,
  type DaemonStartupProgress,
} from "@nervekit/contracts";
import { acquireMigrationLock } from "../migrations/lock.js";
import {
  runStorageMigrations,
  type MigrationReport,
} from "../migrations/index.js";
import { retryRename } from "./file-mutations.js";
import {
  legacyImportMarkerPath,
  type LegacyImportMarker,
  writeLegacyImportEnvelope,
} from "./legacy-import-envelope.js";
import { readLegacyPortableState } from "./legacy-portable-state.js";
import { atomicWriteJson, readJsonFile } from "./json.js";
import { storagePaths } from "./paths.js";
import { inspectWorkbenchHome } from "./state-layout.js";
import { assertCurrentStorage } from "./storage-postconditions.js";

export type LegacyCredentialMigrationStatus = "imported" | "none" | "failed";
export type LegacyPortableImportStatus = "imported" | "none";

export interface LegacyHomeMigrationResult extends LegacyImportMarker {
  backupPath: string;
}

export type StorageStartupErrorCode =
  | "CONSENT_DENIED"
  | "UNSUPPORTED_STATE"
  | "LEGACY_DAEMON_RUNNING"
  | "INVALID_DAEMON_METADATA"
  | "MIGRATION_FAILED"
  | "ROLLBACK_FAILED";

export class StorageStartupError extends Error {
  constructor(
    message: string,
    readonly code: StorageStartupErrorCode,
    readonly details: {
      backupPath?: string;
      originalRestored: boolean;
      cause?: unknown;
      rollbackCause?: unknown;
    },
  ) {
    super(message, { cause: details.cause });
    this.name = "StorageStartupError";
  }
}

export interface StorageStartupResult {
  migrationReport: MigrationReport;
  legacyMigration?: LegacyHomeMigrationResult;
}

interface StartupJournal {
  format: "nerve-storage-startup";
  version: 1;
  home: string;
  backupPath: string;
  phase: "prepared" | "renamed" | "target-created" | "completed";
}

export interface StorageStartupOptions {
  now?: () => Date;
  requestLegacyConsent?: (input: {
    home: string;
    reason: string;
  }) => boolean | Promise<boolean>;
  reportStartupProgress?: (progress: DaemonStartupProgress) => void;
  runMigrations?: typeof runStorageMigrations;
}

export async function coordinateStorageStartup(
  home: string,
  options: StorageStartupOptions = {},
): Promise<StorageStartupResult> {
  const lock = await acquireMigrationLock(`${home}.startup-lock.json`);
  try {
    await recoverStartupJournal(home);
    const inspection = await inspectWorkbenchHome(home);
    if (inspection.kind === "unsupported") {
      throw new StorageStartupError(
        `Nerve cannot prepare ${home}: ${inspection.reason}`,
        "UNSUPPORTED_STATE",
        { originalRestored: true },
      );
    }
    if (inspection.kind !== "legacy") {
      return {
        migrationReport: await runMigrations(home, options),
      };
    }

    const consent = await (options.requestLegacyConsent?.({
      home,
      reason: inspection.reason,
    }) ?? true);
    if (!consent) {
      throw new StorageStartupError(
        "Legacy Nerve storage migration was not approved.",
        "CONSENT_DENIED",
        { originalRestored: true },
      );
    }
    await assertNoRunningLegacyDaemon(home);
    return await migrateLegacyHome(home, options);
  } finally {
    await lock.release();
  }
}

async function migrateLegacyHome(
  home: string,
  options: StorageStartupOptions,
): Promise<StorageStartupResult> {
  const backupPath = await allocateBackupPath(
    home,
    (options.now ?? (() => new Date()))(),
  );
  const journalPath = `${home}.startup-journal.json`;
  let journal: StartupJournal = {
    format: "nerve-storage-startup",
    version: 1,
    home,
    backupPath,
    phase: "prepared",
  };
  await atomicWriteJson(journalPath, journal, 0o600);
  try {
    const portable = await readLegacyPortableState(home);
    await retryRename(home, backupPath);
    journal = await writeJournal(journalPath, journal, "renamed");
    await mkdir(home, { recursive: false, mode: 0o700 });
    await writeLegacyImportEnvelope(home, portable);
    journal = await writeJournal(journalPath, journal, "target-created");
    const migrationReport = await runMigrations(home, options);
    const marker = await readJsonFile<LegacyImportMarker>(
      legacyImportMarkerPath(home),
    );
    journal = await writeJournal(journalPath, journal, "completed");
    await rm(journalPath, { force: true });
    return {
      migrationReport,
      legacyMigration: { ...marker, backupPath },
    };
  } catch (cause) {
    return rollbackStartup(home, backupPath, journalPath, cause);
  }
}

async function runMigrations(
  home: string,
  options: StorageStartupOptions,
): Promise<MigrationReport> {
  const report = await (options.runMigrations ?? runStorageMigrations)(home, {
    now: options.now,
    reportProgress: ({ description }) => {
      options.reportStartupProgress?.({
        type: "nerve.startup.progress",
        phase: "storage-migration",
        message: description,
      });
    },
  });
  if (!options.runMigrations) await assertCurrentStorage(storagePaths(home));
  return report;
}

async function writeJournal(
  path: string,
  journal: StartupJournal,
  phase: StartupJournal["phase"],
): Promise<StartupJournal> {
  const next = { ...journal, phase };
  await atomicWriteJson(path, next, 0o600);
  return next;
}

async function recoverStartupJournal(home: string): Promise<void> {
  const path = `${home}.startup-journal.json`;
  let raw: unknown;
  try {
    raw = await readJsonFile<unknown>(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw new StorageStartupError(
      `Storage startup journal at ${path} is unreadable.`,
      "UNSUPPORTED_STATE",
      { originalRestored: false, cause: error },
    );
  }
  const journal = parseJournal(raw, home);
  if (journal.phase === "completed") {
    await rm(path, { force: true });
    return;
  }
  const homeExists = await strictExists(home);
  const backupExists = await strictExists(journal.backupPath);
  if (journal.phase === "prepared" && homeExists && !backupExists) {
    await rm(path, { force: true });
    return;
  }
  if (!backupExists) {
    throw new StorageStartupError(
      `Storage startup is incomplete and its backup is missing: ${journal.backupPath}`,
      "UNSUPPORTED_STATE",
      { originalRestored: false },
    );
  }
  try {
    if (homeExists) await rm(home, { recursive: true, force: true });
    await retryRename(journal.backupPath, home);
    await rm(path, { force: true });
  } catch (cause) {
    throw new StorageStartupError(
      `Storage startup recovery could not restore ${home}.`,
      "ROLLBACK_FAILED",
      {
        backupPath: journal.backupPath,
        originalRestored: false,
        rollbackCause: cause,
      },
    );
  }
}

function parseJournal(raw: unknown, home: string): StartupJournal {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new StorageStartupError(
      "Storage startup journal is malformed.",
      "UNSUPPORTED_STATE",
      { originalRestored: false },
    );
  }
  const value = raw as Partial<StartupJournal>;
  const phases = new Set([
    "prepared",
    "renamed",
    "target-created",
    "completed",
  ]);
  if (
    value.format !== "nerve-storage-startup" ||
    value.version !== 1 ||
    value.home !== home ||
    typeof value.backupPath !== "string" ||
    dirname(value.backupPath) !== dirname(home) ||
    !value.backupPath.startsWith(`${home}-bk-`) ||
    !value.phase ||
    !phases.has(value.phase)
  ) {
    throw new StorageStartupError(
      "Storage startup journal is malformed or does not belong to this home.",
      "UNSUPPORTED_STATE",
      { originalRestored: false },
    );
  }
  return value as StartupJournal;
}

async function assertNoRunningLegacyDaemon(home: string): Promise<void> {
  const path = `${home}/daemon.json`;
  let raw: string;
  try {
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error("daemon.json is not a regular file");
    }
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw new StorageStartupError(
      `Legacy daemon metadata at ${path} is unreadable or invalid.`,
      "INVALID_DAEMON_METADATA",
      { originalRestored: true, cause: error },
    );
  }
  const parsed = daemonFileSchema.safeParse(safeJson(raw));
  if (!parsed.success || parsed.data.dataDir !== home) {
    throw new StorageStartupError(
      `Legacy daemon metadata at ${path} is invalid or belongs to another data directory.`,
      "INVALID_DAEMON_METADATA",
      {
        originalRestored: true,
        cause: parsed.success ? undefined : parsed.error,
      },
    );
  }
  if (!isProcessAlive(parsed.data.pid)) return;
  throw new StorageStartupError(
    `A legacy Nerve daemon (PID ${parsed.data.pid}) is still running. Quit all existing Nerve processes and try again.`,
    "LEGACY_DAEMON_RUNNING",
    { originalRestored: true },
  );
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

async function allocateBackupPath(home: string, now: Date): Promise<string> {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid backup date.");
  const compact = now.toISOString().replaceAll(/[-:]/g, "");
  const base = `${home}-bk-${compact.slice(0, 8)}-${compact.slice(9, 15)}`;
  let candidate = base;
  for (let suffix = 2; await strictExists(candidate); suffix += 1) {
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

async function rollbackStartup(
  home: string,
  backupPath: string,
  journalPath: string,
  cause: unknown,
): Promise<never> {
  try {
    const backupExists = await strictExists(backupPath);
    if (backupExists) {
      if (await strictExists(home)) {
        await rm(home, { recursive: true, force: true });
      }
      await retryRename(backupPath, home);
    }
    await rm(journalPath, { force: true });
  } catch (rollbackCause) {
    throw new StorageStartupError(
      `Nerve could not prepare ${home}, and automatic rollback also failed. The backup remains at ${backupPath}.`,
      "ROLLBACK_FAILED",
      { backupPath, cause, rollbackCause, originalRestored: false },
    );
  }
  throw new StorageStartupError(
    `Nerve could not prepare ${home}. The original legacy home was restored.`,
    "MIGRATION_FAILED",
    { cause, originalRestored: true },
  );
}

async function strictExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
