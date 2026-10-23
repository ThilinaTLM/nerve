import type { ExportReceipt } from "./released-export.js";

/** The production adapter uses SQLite; state-machine unit tests supply a fake. */
export interface MigrationBackend {
  state(): "released" | "converted";
  preserveDatabase(): Promise<void>;
  verifyBackup(): void;
  verifyReleased(): void;
  verifyConverted(): void;
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
  verifyFiles(): void;
  retire(receipt: ExportReceipt): void;
  receipts: readonly ExportReceipt[];
  /** Durable external receipt, not a second SQL settings/index table. */
  committed(): void;
}
export async function executeReleasedMigration(
  db: MigrationBackend,
  files: MigrationCompletion,
): Promise<void> {
  files.verifyFiles();
  if (db.state() === "converted") {
    db.verifyBackup();
    db.verifyConverted();
    files.committed();
    return;
  }
  db.verifyReleased();
  await db.preserveDatabase();
  db.verifyBackup();
  db.begin();
  let committed = false;
  try {
    // Recheck both authorities at the final transaction boundary. A document
    // failure may never be discarded in order to permit destructive SQL.
    db.verifyReleased();
    files.verifyFiles();
    db.metadata();
    db.rebuild();
    db.trust();
    db.recordVersion();
    db.foreignKeys();
    db.verifyConverted();
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
export function retireReleasedSources(files: MigrationCompletion): void {
  files.verifyFiles();
  for (const receipt of files.receipts) files.retire(receipt);
}
