import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { StoragePaths } from "../storage/paths.js";
import { storagePaths } from "../storage/paths.js";
import { pathExists } from "../storage/json.js";
import {
  readLedger,
  ledgerDigest,
  validateLedger,
  writeLedger,
} from "./ledger.js";
import { acquireMigrationLock } from "./lock.js";
import type {
  MigrationContext,
  MigrationReport,
  StorageMigration,
} from "./migration.js";
import { MigrationError } from "./migration.js";
import { storageMigrationRegistry } from "./registry.js";
import {
  createRollbackBundle,
  discardRollbackBundle,
  recoverInterruptedBatch,
  type RollbackBundle,
} from "./rollback-bundle.js";
import { transaction, withMigrationDatabase } from "./sqlite.js";
import {
  CANONICAL_SCHEMA_CHECKSUM,
  CANONICAL_SCHEMA_VERSION,
} from "../canonical-store/schema.js";

export interface RunStorageMigrationsOptions {
  registry?: readonly StorageMigration[];
  now?: () => Date;
  diagnostic?: (message: string) => void;
  reportProgress?: (progress: {
    migrationId: string;
    description: string;
  }) => void;
  lockTimeoutMs?: number;
}

export async function runStorageMigrations(
  home: string,
  options: RunStorageMigrationsOptions = {},
): Promise<MigrationReport> {
  const paths = storagePaths(home);
  if (await pathExists(paths.sqlitePath)) {
    const canonical = (() => {
      try {
        return withMigrationDatabase(paths.sqlitePath, (database) =>
          Boolean(
            database
              .prepare(
                `SELECT 1 AS present FROM sqlite_master
                 WHERE type = 'table' AND name = 'schema_migrations'`,
              )
              .get(),
          ),
        );
      } catch {
        return false;
      }
    })();
    if (canonical) return runCanonicalMigrations(home, options);
  }
  return runLegacyImportMigrations(home, options);
}

async function runLegacyImportMigrations(
  home: string,
  options: RunStorageMigrationsOptions = {},
): Promise<MigrationReport> {
  const startedAt = performance.now();
  const paths = storagePaths(home);
  const migrationsDir = join(home, "migrations");
  await mkdir(home, { recursive: true, mode: 0o700 });
  await mkdir(migrationsDir, { recursive: true, mode: 0o700 });
  const lock = await acquireMigrationLock(
    join(migrationsDir, "lock.json"),
    options.lockTimeoutMs,
  );
  try {
    const registry = options.registry ?? storageMigrationRegistry;
    const ledgerPath = join(migrationsDir, "ledger.json");
    const ledger = await readLedger(ledgerPath).catch((error) => {
      throw new MigrationError(
        "Storage migration ledger is malformed.",
        undefined,
        { cause: error },
      );
    });
    await recoverInterruptedBatch(
      home,
      migrationsDir,
      paths.sqlitePath,
      ledgerDigest(ledger),
    );
    validateLedger(ledger, registry);
    const context = createContext(paths, options);
    const unrecorded = registry.slice(ledger.applied.length);
    const decisions = new Map<string, "ran" | "detected">();
    const pending: StorageMigration[] = [];
    for (const migration of unrecorded) {
      const detection = await migration.detect(context).catch((error) => {
        throw new MigrationError(
          `Failed to detect migration '${migration.id}'.`,
          migration.id,
          { cause: error },
        );
      });
      decisions.set(migration.id, detection === "current" ? "detected" : "ran");
      if (detection === "pending") pending.push(migration);
      else await migration.verify(context);
    }

    const executionDurations = new Map<string, number>();

    let bundle: RollbackBundle | undefined;
    if (pending.length > 0) {
      const specs = await Promise.all(
        pending.map((migration) => migration.backup(context)),
      );
      const batchId = `batch-${Date.now()}-${process.pid}`;
      bundle = await createRollbackBundle({
        home,
        migrationsDir,
        id: batchId,
        ledgerDigest: ledgerDigest(ledger),
        paths: specs.flatMap((spec) => spec.paths),
      });
      let activeMigrationId: string | undefined;
      try {
        for (const migration of pending) {
          activeMigrationId = migration.id;
          const migrationStartedAt = performance.now();
          context.diagnostic(`Applying storage migration ${migration.id}`);
          options.reportProgress?.({
            migrationId: migration.id,
            description: migration.description,
          });
          await migration.up(context);
          await migration.verify(context);
          executionDurations.set(
            migration.id,
            Math.round(performance.now() - migrationStartedAt),
          );
        }
      } catch (error) {
        await recoverInterruptedBatch(
          home,
          migrationsDir,
          paths.sqlitePath,
        ).catch((restoreError) => {
          throw new MigrationError(
            "Storage migration failed and automatic rollback also failed.",
            undefined,
            {
              cause: new AggregateError([error, restoreError]),
            },
          );
        });
        throw new MigrationError(
          `Storage migration '${activeMigrationId ?? "unknown"}' failed and the batch was rolled back.`,
          activeMigrationId,
          { cause: error },
        );
      }
    }

    const committedAt = (options.now?.() ?? new Date()).toISOString();
    const entries = [
      ...ledger.applied,
      ...unrecorded.map((migration) => ({
        id: migration.id,
        checksum: migration.checksum,
        description: migration.description,
        appliedAt: committedAt,
        execution: decisions.get(migration.id) ?? "detected",
      })),
    ];
    if (unrecorded.length > 0) {
      await writeLedger(ledgerPath, {
        ...ledger,
        applied: entries,
        lastSuccessfulBatch: {
          id: bundle?.id ?? `baseline-${Date.now()}`,
          committedAt,
        },
      });
    }
    if (bundle) await discardRollbackBundle(bundle);
    const archives: string[] = [];
    for (const migration of pending) {
      const archive = join(migrationsDir, "archives", migration.id);
      if (await pathExists(archive)) archives.push(archive);
    }
    return {
      durationMs: Math.round(performance.now() - startedAt),
      executions: unrecorded.map((migration) => ({
        id: migration.id,
        execution: decisions.get(migration.id) ?? "detected",
        durationMs: executionDurations.get(migration.id) ?? 0,
      })),
      backupBytes: bundle?.bytes ?? 0,
      archivePaths: archives,
    };
  } finally {
    await lock.release();
  }
}

async function runCanonicalMigrations(
  home: string,
  options: RunStorageMigrationsOptions,
): Promise<MigrationReport> {
  const startedAt = performance.now();
  const paths = storagePaths(home);
  const migrationsDir = join(home, "migrations");
  await mkdir(migrationsDir, { recursive: true, mode: 0o700 });
  const lock = await acquireMigrationLock(
    join(migrationsDir, "lock.json"),
    options.lockTimeoutMs,
  );
  try {
    await recoverInterruptedBatch(home, migrationsDir, paths.sqlitePath);
    const rows = withMigrationDatabase(paths.sqlitePath, (database) =>
      database
        .prepare(
          `SELECT version, checksum FROM schema_migrations ORDER BY version`,
        )
        .all(),
    ) as unknown as Array<{ version: number; checksum: string }>;
    const newest = rows.at(-1);
    if (!newest)
      throw new MigrationError("Canonical migration ledger is empty.");
    if (newest.version > CANONICAL_SCHEMA_VERSION) {
      throw new MigrationError(
        `Storage schema ${newest.version} is newer than supported schema ${CANONICAL_SCHEMA_VERSION}.`,
      );
    }

    if (newest.version < CANONICAL_SCHEMA_VERSION) {
      throw new MigrationError(
        `Storage schema ${newest.version} predates the supported canonical baseline ${CANONICAL_SCHEMA_VERSION}.`,
      );
    }

    withMigrationDatabase(paths.sqlitePath, (database) => {
      const current = database
        .prepare(`SELECT checksum FROM schema_migrations WHERE version = ?`)
        .get(CANONICAL_SCHEMA_VERSION) as { checksum?: string } | undefined;
      if (current?.checksum !== CANONICAL_SCHEMA_CHECKSUM) {
        throw new MigrationError(
          `Storage schema checksum drift at version ${CANONICAL_SCHEMA_VERSION}.`,
        );
      }
      const foreignKeys = database.prepare("PRAGMA foreign_key_check").all();
      if (foreignKeys.length > 0)
        throw new MigrationError("Canonical SQLite foreign key check failed.");
      const quick = database.prepare("PRAGMA quick_check").get() as
        | { quick_check?: string }
        | undefined;
      if (quick?.quick_check !== "ok")
        throw new MigrationError("Canonical SQLite quick check failed.");
    });
    return {
      durationMs: Math.round(performance.now() - startedAt),
      executions: [],
      backupBytes: 0,
      archivePaths: [],
    };
  } finally {
    await lock.release();
  }
}

function createContext(
  paths: StoragePaths,
  options: RunStorageMigrationsOptions,
): MigrationContext {
  return {
    paths,
    now: options.now ?? (() => new Date()),
    diagnostic: options.diagnostic ?? (() => undefined),
    withDatabase: (operation) =>
      withMigrationDatabase(paths.sqlitePath, operation),
    transaction: (operation) =>
      withMigrationDatabase(paths.sqlitePath, (database) =>
        transaction(database, () => operation(database)),
      ),
  };
}
