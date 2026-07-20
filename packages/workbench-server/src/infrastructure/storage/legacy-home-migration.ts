import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { daemonFileSchema } from "@nervekit/contracts";
import { EncryptedFileSecretProvider } from "../secrets/index.js";
import { initializeStorage } from "./initialize.js";
import { retryRename } from "./file-mutations.js";
import { atomicWriteJson, pathExists } from "./json.js";
import {
  type LegacyPortableState,
  readLegacyPortableState,
} from "./legacy-portable-state.js";
import { storagePaths } from "./paths.js";
import {
  inspectWorkbenchHome,
  type WorkbenchHomeInspection,
} from "./state-layout.js";

export type LegacyCredentialMigrationStatus = "imported" | "none" | "failed";
export type LegacyPortableImportStatus = "imported" | "none";

export interface LegacyHomeMigrationResult {
  backupPath: string;
  settingsStatus: LegacyPortableImportStatus;
  providerCatalogStatus: LegacyPortableImportStatus;
  importedCustomProviderCount: number;
  importedCustomModelCount: number;
  importedCredentialCount: number;
  credentialStatus: LegacyCredentialMigrationStatus;
}

export interface LegacyHomeMigrationOptions {
  now?: () => Date;
  /** Dependency seam used by storage transaction tests. */
  initializeFreshHome?: typeof initializeStorage;
  /** Dependency seam used by storage transaction tests. */
  writeCredential?: (
    home: string,
    name: string,
    value: string,
  ) => Promise<void>;
}

export type LegacyHomeMigrationErrorCode =
  | "NOT_LEGACY"
  | "LEGACY_DAEMON_RUNNING"
  | "MIGRATION_FAILED"
  | "ROLLBACK_FAILED";

export class LegacyHomeMigrationError extends Error {
  constructor(
    message: string,
    readonly code: LegacyHomeMigrationErrorCode,
    readonly details: {
      backupPath?: string;
      originalRestored: boolean;
      cause?: unknown;
      rollbackCause?: unknown;
    },
  ) {
    super(message, { cause: details.cause });
    this.name = "LegacyHomeMigrationError";
  }
}

/**
 * Replaces an unversioned legacy Nerve home with a freshly initialized one
 * while retaining the complete legacy tree as a timestamped backup.
 *
 * Portable user state — validated settings, the custom provider/model catalog,
 * and provider/tool credentials — is restored into the new home. Operational
 * state (projects, conversations, agents, logs, plans, run history, SQLite,
 * daemon/session files) is deliberately not imported; it remains only in the
 * backup. Malformed settings or catalog data aborts the migration and restores
 * the original home.
 */
export async function migrateLegacyWorkbenchHome(
  home: string,
  options: LegacyHomeMigrationOptions = {},
): Promise<LegacyHomeMigrationResult> {
  const inspection = await inspectWorkbenchHome(home);
  assertLegacyInspection(home, inspection);
  await assertNoRunningLegacyDaemon(home);

  const backupPath = await allocateBackupPath(
    home,
    (options.now ?? (() => new Date()))(),
  );
  await retryRename(home, backupPath).catch((cause: unknown) => {
    throw new LegacyHomeMigrationError(
      `Could not move the legacy Nerve home to ${backupPath}. No data was changed.`,
      "MIGRATION_FAILED",
      { cause, originalRestored: true },
    );
  });

  let portable: LegacyPortableState;
  try {
    portable = await readLegacyPortableState(backupPath);
    await (options.initializeFreshHome ?? initializeStorage)(home);
    const paths = storagePaths(home);
    if (portable.settings) {
      await atomicWriteJson(paths.configPath, portable.settings, 0o600);
    }
    if (portable.providerCatalog) {
      await atomicWriteJson(
        paths.providersPath,
        portable.providerCatalog,
        0o600,
      );
    }
    const writeCredential =
      options.writeCredential ??
      (async (targetHome: string, name: string, value: string) => {
        await new EncryptedFileSecretProvider(targetHome).set(name, value);
      });
    for (const [name, value] of portable.credentials) {
      await writeCredential(home, name, value);
    }
  } catch (cause) {
    return rollbackMigration(home, backupPath, cause);
  }

  return {
    backupPath,
    settingsStatus: portable.settings ? "imported" : "none",
    providerCatalogStatus: portable.providerCatalog ? "imported" : "none",
    importedCustomProviderCount:
      portable.providerCatalog?.providers.length ?? 0,
    importedCustomModelCount: portable.providerCatalog?.models.length ?? 0,
    importedCredentialCount: portable.credentials.length,
    credentialStatus:
      portable.credentialStatus === "failed"
        ? "failed"
        : portable.credentials.length > 0
          ? "imported"
          : "none",
  };
}

function assertLegacyInspection(
  home: string,
  inspection: WorkbenchHomeInspection,
): asserts inspection is Extract<WorkbenchHomeInspection, { kind: "legacy" }> {
  if (inspection.kind === "legacy") return;
  throw new LegacyHomeMigrationError(
    inspection.kind === "unsupported"
      ? `Nerve cannot automatically replace the versioned state at ${home}: ${inspection.reason}`
      : `Nerve did not find unversioned legacy state at ${home}.`,
    "NOT_LEGACY",
    { originalRestored: true },
  );
}

async function assertNoRunningLegacyDaemon(home: string): Promise<void> {
  const daemonPath = join(home, "daemon.json");
  if (!(await pathExists(daemonPath))) return;
  const daemon = await readFile(daemonPath, "utf8")
    .then((raw) => daemonFileSchema.safeParse(JSON.parse(raw)))
    .catch(() => undefined);
  if (!daemon?.success || !isProcessAlive(daemon.data.pid)) return;
  throw new LegacyHomeMigrationError(
    `A legacy Nerve daemon (PID ${daemon.data.pid}) is still running. Quit all existing Nerve processes and try again.`,
    "LEGACY_DAEMON_RUNNING",
    { originalRestored: true },
  );
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
  const timestamp = formatBackupTimestamp(now);
  const base = `${home}-bk-${timestamp}`;
  let candidate = base;
  let suffix = 2;
  while (await pathExists(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function formatBackupTimestamp(value: Date): string {
  if (!Number.isFinite(value.getTime())) {
    throw new Error("Cannot create a Nerve backup name from an invalid date.");
  }
  const compact = value.toISOString().replaceAll(/[-:]/g, "");
  return `${compact.slice(0, 8)}-${compact.slice(9, 15)}`;
}

async function rollbackMigration(
  home: string,
  backupPath: string,
  cause: unknown,
): Promise<never> {
  try {
    await rm(home, { recursive: true, force: true });
    await retryRename(backupPath, home);
  } catch (rollbackCause) {
    throw new LegacyHomeMigrationError(
      `Nerve could not finish preparing ${home}, and automatic rollback also failed. The legacy backup remains at ${backupPath}.`,
      "ROLLBACK_FAILED",
      {
        backupPath,
        cause,
        rollbackCause,
        originalRestored: false,
      },
    );
  }
  throw new LegacyHomeMigrationError(
    `Nerve could not finish preparing ${home}. The original legacy home was restored.`,
    "MIGRATION_FAILED",
    { cause, originalRestored: true },
  );
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
