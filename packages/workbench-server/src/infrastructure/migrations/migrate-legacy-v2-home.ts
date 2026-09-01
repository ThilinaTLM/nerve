import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  homeMigrationReportSchema,
  type HomeMigrationProgress,
  type HomeMigrationReport,
} from "@nervekit/contracts/storage";
import { DatabaseSync } from "node:sqlite";
import {
  readHomeConfiguration,
  writeHomeConfiguration,
} from "../configuration/home-configuration.js";
import { EncryptedFileSecretProvider } from "../secrets/index.js";
import {
  atomicWriteJson,
  pathExists,
  readJsonFile,
} from "../storage-bootstrap/json.js";
import { initializeStorage } from "../storage-bootstrap/initialize.js";
import { storagePaths } from "../storage-bootstrap/paths.js";
import { assertCurrentStorage } from "../storage-bootstrap/storage-postconditions.js";
import { acquireStorageStartupLock } from "../storage-bootstrap/startup-lock.js";
import { migrateLegacyConfiguration } from "./configuration.js";
import {
  assertLegacyDaemonStopped,
  childRegularFiles,
  inspectLegacyV2Home,
  readLegacyCredentials,
} from "./legacy-v2.js";
import { importPost0012State, readPost0012Configuration } from "./post-0012.js";

type ProgressReporter = (progress: HomeMigrationProgress) => void;

export async function migrateLegacyV2Home(
  home: string,
  options: {
    now?: () => Date;
    reportProgress?: ProgressReporter;
  } = {},
): Promise<HomeMigrationReport> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const stamp = startedAt.toISOString().replace(/[-:.]/g, "");
  const parent = dirname(resolve(home));
  const base = resolve(home).split(sep).at(-1) ?? "nerve-home";
  const staging = join(parent, `.${base}.migration-${stamp}`);
  const backupSibling = join(parent, `.${base}.legacy-v2-${stamp}`);
  const journalPath = `${resolve(home)}.migration.json`;
  const finalBackupPath = join(resolve(home), "backups", `legacy-v2-${stamp}`);
  assertSeparatePaths(home, staging, backupSibling);

  const lock = await acquireStorageStartupLock(home, 15_000);
  let sourceRenamed = false;
  let promoted = false;
  try {
    const recovered = await recoverMigration(home, journalPath);
    if (recovered) return recovered;
    report(options.reportProgress, "inspect", "Inspecting legacy Nerve home");
    const inspection = await inspectLegacyV2Home(home);
    if (inspection.kind !== "legacy-v2") throw new Error(inspection.reason);
    await assertLegacyDaemonStopped(home);
    for (const path of [staging, backupSibling, journalPath]) {
      if (await lstat(path).catch(() => undefined)) {
        throw new Error(`Migration work path already exists: ${path}`);
      }
    }
    await writeJournal(
      journalPath,
      home,
      staging,
      backupSibling,
      finalBackupPath,
      "inspected",
    );

    report(
      options.reportProgress,
      "stage",
      "Creating isolated v1 staging home",
    );
    const storage = await initializeStorage(staging);
    await storage.canonicalStore.close();
    await writeJournal(
      journalPath,
      home,
      staging,
      backupSibling,
      finalBackupPath,
      "staging-created",
    );

    const warnings: string[] = [
      "Legacy project permission allows were not trusted and require re-approval.",
      "Task process state and task logs were not imported.",
    ];
    report(
      options.reportProgress,
      "configuration",
      "Migrating configuration and credentials",
    );
    const credentials = await readLegacyCredentials(home);
    const configurationSource = await readPost0012Configuration(
      home,
      credentials.keys(),
    );
    const configuration = migrateLegacyConfiguration(configurationSource);
    await writeHomeConfiguration(storage.paths, configuration);
    const targetSecrets = new EncryptedFileSecretProvider(staging);
    for (const [name, value] of credentials)
      await targetSecrets.set(name, value);

    report(options.reportProgress, "files", "Migrating plans");
    const fileResult = await migratePlanFiles(home, staging);

    report(
      options.reportProgress,
      "conversations",
      "Migrating conversation history",
    );
    const imported = await importPost0012State({
      sourceHome: home,
      targetHome: staging,
      targetSqlitePath: storage.paths.sqlitePath,
      now: startedAt,
    });
    const counts = countMigratedState(storage.paths.sqlitePath);
    fileResult.assets.push(...imported.payloadAssets);
    counts.credentials = credentials.size;
    counts.payloads = imported.payloadAssets.length;
    counts.plans = fileResult.planCount;
    insertFileAssets(storage.paths.sqlitePath, fileResult.assets);

    const ledger = await readJsonFile<{
      format: string;
      version: number;
      entries: Array<Record<string, unknown>>;
    }>(storage.paths.migrationLedgerPath);
    ledger.entries.push({
      id: "legacy-v2-to-nerve-home-v1",
      appliedAt: now().toISOString(),
      source: {
        format: "nerve-workbench-state",
        version: 2,
      },
      counts,
    });
    await atomicWriteJson(storage.paths.migrationLedgerPath, ledger, 0o600);

    report(options.reportProgress, "validate", "Validating migrated v1 home");
    await validateMigratedHome(staging, counts);
    const completedAt = now();
    const migrationReport = homeMigrationReportSchema.parse({
      format: "nerve-home-migration",
      version: 1,
      sourceFormat: "nerve-workbench-state",
      sourceVersion: 2,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      backupPath: finalBackupPath,
      counts,
      warnings,
    });
    await atomicWriteJson(
      join(storage.paths.migrationsPath, "legacy-v2-import.json"),
      migrationReport,
      0o600,
    );
    await writeJournal(
      journalPath,
      home,
      staging,
      backupSibling,
      finalBackupPath,
      "validated",
    );

    report(
      options.reportProgress,
      "promote",
      "Promoting migrated home and retaining legacy backup",
    );
    await rename(home, backupSibling);
    sourceRenamed = true;
    await writeJournal(
      journalPath,
      home,
      staging,
      backupSibling,
      finalBackupPath,
      "source-renamed",
    );
    try {
      await rename(staging, home);
      promoted = true;
    } catch (error) {
      await rename(backupSibling, home);
      sourceRenamed = false;
      throw error;
    }
    await writeJournal(
      journalPath,
      home,
      staging,
      backupSibling,
      finalBackupPath,
      "staging-promoted",
    );
    await mkdir(dirname(finalBackupPath), { recursive: true, mode: 0o700 });
    await rename(backupSibling, finalBackupPath);
    sourceRenamed = false;
    await writeJournal(
      journalPath,
      home,
      staging,
      finalBackupPath,
      finalBackupPath,
      "backup-retained",
    );
    await rm(journalPath, { force: true });
    return migrationReport;
  } catch (error) {
    if (sourceRenamed && !promoted) {
      await rename(backupSibling, home).catch(() => undefined);
    }
    if (!promoted) await rm(staging, { recursive: true, force: true });
    throw error;
  } finally {
    await lock.release();
  }
}

async function migratePlanFiles(
  source: string,
  target: string,
): Promise<{
  planCount: number;
  assets: FileAssetInput[];
}> {
  const assets: FileAssetInput[] = [];
  const sourcePlans = join(source, "plans");
  const targetPlans = storagePaths(target).plansPath;
  let planCount = 0;
  for (const file of await childRegularFiles(sourcePlans)) {
    const sourcePath = join(sourcePlans, file);
    const targetPath = join(targetPlans, file);
    assertWithin(targetPlans, targetPath);
    await mkdir(dirname(targetPath), { recursive: true, mode: 0o755 });
    await copyFile(sourcePath, targetPath);
    await chmod(targetPath, 0o600).catch(() => undefined);
    const bytes = await readFile(targetPath);
    const info = await stat(sourcePath);
    assets.push({
      category: "plan",
      logicalPath: `plans/${file.split(sep).join("/")}`,
      digest: createHash("sha256").update(bytes).digest("hex"),
      byteLength: bytes.byteLength,
      mediaType: "text/markdown",
      timestamp: info.mtimeMs,
    });
    planCount += 1;
  }
  return {
    planCount,
    assets,
  };
}

function countMigratedState(targetPath: string): HomeMigrationReport["counts"] {
  const database = new DatabaseSync(targetPath, { readOnly: true });
  try {
    const count = (sql: string) =>
      Number((database.prepare(sql).get() as { count: number }).count);
    return {
      conversations: count(
        `SELECT COUNT(DISTINCT scope_id) AS count FROM domain_documents
         WHERE namespace IN (
           'conversation_state',
           'conversation_journal_head',
           'conversation_journal_commit'
         )`,
      ),
      conversationRecords: count(
        "SELECT COUNT(*) AS count FROM conversation_records",
      ),
      durableEvents: count("SELECT COUNT(*) AS count FROM durable_events"),
      projects: count(
        "SELECT COUNT(*) AS count FROM domain_documents WHERE namespace = 'project'",
      ),
      agents: count(
        "SELECT COUNT(*) AS count FROM domain_documents WHERE namespace = 'agent'",
      ),
      payloads: 0,
      plans: 0,
      credentials: 0,
    };
  } finally {
    database.close();
  }
}

interface FileAssetInput {
  category: "payload" | "plan";
  logicalPath: string;
  conversationId?: string;
  toolCallId?: string;
  digest: string;
  byteLength: number;
  mediaType: string;
  timestamp: number;
}

function insertFileAssets(path: string, assets: FileAssetInput[]): void {
  const database = new DatabaseSync(path);
  try {
    const insert = database.prepare(
      `INSERT INTO file_assets (
        id, category, logical_path, conversation_id, tool_call_id, task_id,
        digest, byte_length, media_type, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    );
    database.exec("BEGIN IMMEDIATE");
    try {
      for (const asset of assets) {
        const id = `asset_${createHash("sha256").update(`${asset.category}\0${asset.logicalPath}`).digest("hex").slice(0, 32)}`;
        insert.run(
          id,
          asset.category,
          asset.logicalPath,
          asset.conversationId ?? null,
          asset.toolCallId ?? null,
          asset.digest,
          asset.byteLength,
          asset.mediaType,
          Math.trunc(asset.timestamp),
          Math.trunc(asset.timestamp),
        );
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
}

async function validateMigratedHome(
  home: string,
  counts: HomeMigrationReport["counts"],
): Promise<void> {
  const paths = storagePaths(home);
  await assertCurrentStorage(paths);
  const configuration = await readHomeConfiguration(paths);
  void configuration;
  const database = new DatabaseSync(paths.sqlitePath, { readOnly: true });
  try {
    const row = database
      .prepare(
        `SELECT
           (SELECT COUNT(DISTINCT scope_id) FROM domain_documents
             WHERE namespace IN (
               'conversation_state',
               'conversation_journal_head',
               'conversation_journal_commit'
             )) AS conversations,
           (SELECT COUNT(*) FROM conversation_records) AS records,
           (SELECT COUNT(*) FROM durable_events) AS events,
           (SELECT COUNT(*) FROM conversation_records
             WHERE json_valid(CAST(data AS TEXT)) = 0) +
           (SELECT COUNT(*) FROM durable_events
             WHERE json_valid(CAST(data AS TEXT)) = 0) +
           (SELECT COUNT(*) FROM domain_documents
             WHERE json_valid(CAST(data AS TEXT)) = 0) AS invalid_json`,
      )
      .get() as {
      conversations: number;
      records: number;
      events: number;
      invalid_json: number;
    };
    if (
      row.conversations !== counts.conversations ||
      row.records !== counts.conversationRecords ||
      row.events !== counts.durableEvents ||
      row.invalid_json !== 0
    ) {
      throw new Error("Migrated conversation validation failed.");
    }
  } finally {
    database.close();
  }
}

function assertSeparatePaths(...paths: string[]): void {
  const resolved = paths.map((path) => resolve(path));
  if (new Set(resolved).size !== resolved.length) {
    throw new Error("Migration source and work paths must be distinct.");
  }
}

function assertWithin(root: string, path: string): void {
  const candidate = relative(resolve(root), resolve(path));
  if (
    candidate === "" ||
    candidate.startsWith(`..${sep}`) ||
    candidate === ".." ||
    resolve(candidate) === candidate
  ) {
    throw new Error(`Managed migration path escapes its root: ${path}`);
  }
}

function report(
  reporter: ProgressReporter | undefined,
  phase: HomeMigrationProgress["phase"],
  message: string,
): void {
  reporter?.({ phase, message });
}

async function recoverMigration(
  home: string,
  journalPath: string,
): Promise<HomeMigrationReport | undefined> {
  if (!(await pathExists(journalPath))) return undefined;
  const journal = await readJsonFile<{
    format: string;
    version: number;
    home: string;
    staging: string;
    backup: string;
    finalBackup: string;
    phase: string;
  }>(journalPath);
  if (
    journal.format !== "nerve-home-migration-journal" ||
    journal.version !== 1 ||
    resolve(journal.home) !== resolve(home)
  ) {
    throw new Error(`Migration journal at ${journalPath} is invalid.`);
  }
  const homeExists = await pathExists(home);
  const stagingExists = await pathExists(journal.staging);
  const backupExists = await pathExists(journal.backup);

  if (
    (journal.phase === "staging-promoted" ||
      journal.phase === "backup-retained" ||
      (journal.phase === "source-renamed" && homeExists && !stagingExists)) &&
    homeExists
  ) {
    if (
      backupExists &&
      resolve(journal.backup) !== resolve(journal.finalBackup)
    ) {
      await mkdir(dirname(journal.finalBackup), {
        recursive: true,
        mode: 0o700,
      });
      await rename(journal.backup, journal.finalBackup);
    }
    const reportPath = join(
      storagePaths(home).migrationsPath,
      "legacy-v2-import.json",
    );
    const migrationReport = homeMigrationReportSchema.parse(
      await readJsonFile(reportPath),
    );
    await rm(journalPath, { force: true });
    return migrationReport;
  }

  if (!homeExists && backupExists) await rename(journal.backup, home);
  if (stagingExists)
    await rm(journal.staging, { recursive: true, force: true });
  await rm(journalPath, { force: true });
  return undefined;
}

async function writeJournal(
  path: string,
  home: string,
  staging: string,
  backup: string,
  finalBackup: string,
  phase: string,
): Promise<void> {
  await atomicWriteJson(
    path,
    {
      format: "nerve-home-migration-journal",
      version: 1,
      home: resolve(home),
      staging,
      backup,
      finalBackup,
      phase,
      updatedAt: new Date().toISOString(),
    },
    0o600,
  );
}
