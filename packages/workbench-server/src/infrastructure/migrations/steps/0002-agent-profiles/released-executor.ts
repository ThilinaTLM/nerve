import type { ExportReceipt } from "./released-export.js";

/** The production adapter uses SQLite; state-machine unit tests supply a fake. */
export interface MigrationBackend {
  state(): "released" | "converted";
  preserveDatabase(): Promise<void>;
  verifyBackup(): void;
  verifyReleased(): void | Promise<void>;
  verifyConverted(): void | Promise<void>;
  begin(): void;
  metadata(): void;
  rebuild(): void;
  trust(): void;
  recordVersion(): void;
  foreignKeys(): void;
  commit(): void;
  rollback(): void;
}
export interface MigrationCompletion {
  verifyFiles(): void | Promise<void>;
  retire(receipt: ExportReceipt): void | Promise<void>;
  receipts: readonly ExportReceipt[];
  /** Durable external receipt, not a second SQL settings/index table. */
  committed(): void;
}
export async function executeReleasedMigration(
  db: MigrationBackend,
  files: MigrationCompletion,
  progress?: (phase: string, label: string) => Promise<void>,
): Promise<void> {
  await files.verifyFiles();
  if (db.state() === "converted") {
    await progress?.("verify-backup", "Checking database backup");
    db.verifyBackup();
    await db.verifyConverted();
    files.committed();
    return;
  }
  await db.verifyReleased();
  await progress?.("backup", "Backing up database");
  await db.preserveDatabase();
  await progress?.("verify-backup", "Checking database backup");
  db.verifyBackup();
  db.begin();
  let committed = false;
  try {
    // Recheck both authorities at the final transaction boundary. A document
    // failure may never be discarded in order to permit destructive SQL.
    await db.verifyReleased();
    await files.verifyFiles();
    await progress?.("update-database", "Updating database");
    db.metadata();
    db.rebuild();
    db.trust();
    db.recordVersion();
    db.foreignKeys();
    await db.verifyConverted();
    db.commit();
    committed = true;
    files.committed();
  } catch (error) {
    if (!committed) db.rollback();
    throw error;
  }
}
/** Runner invokes after its durable verified marker. Retry is source-digest
 * checked and idempotent; a postcommit crash never repeats DDL or row export. */
export async function retireReleasedSources(
  files: MigrationCompletion,
): Promise<void> {
  await files.verifyFiles();
  for (const receipt of files.receipts) await files.retire(receipt);
}
