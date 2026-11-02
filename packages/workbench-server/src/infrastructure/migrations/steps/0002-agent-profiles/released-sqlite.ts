import { phaseProgress } from "./progress.js";
import { verifyConvertedConversationData } from "./released-verification.js";
import {
  reviewedNewTables,
  verifyConvertedTableSql,
} from "./released-schema-verification.js";
import assert from "node:assert/strict";
import { backup, DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { coreMigrations } from "@nervekit/conversation-core";
import type { StepContext } from "../../framework/step.js";
import {
  syncDirectory,
  syncFile,
  renameWithRetrySync,
} from "../../framework/durability.js";
import { json, readText, writeProtected, safePath } from "./files.js";
import {
  sha256,
  jsonBytes,
  type ReleasedConversation,
} from "./released-format.js";
import type { MigrationBackend } from "./released-executor.js";
import type { Plan } from "./step.js";
import { releasedRowDigest } from "./released-export.js";
import {
  preserveDatabaseBackup,
  verifyDatabaseBackup,
  databaseBackupReceiptSchema,
  type DatabaseBackupIO,
} from "./released-backup.js";
const trustTargetId = (target: Plan["trust"][number]) =>
  `trust_${sha256(`${target.projectId}|${target.kind}|${target.path}`)}`;

const v2 = coreMigrations.find((migration) => migration.version === 2)!;

/** Production adapter for the approved migration. State-machine unit tests use
 * a fake instead of constructing this SQLite-backed class. */
export class ReleasedSqliteBackend implements MigrationBackend {
  readonly db: DatabaseSync;
  private readonly backupPath: string;
  private readonly backupReceipt: string;
  constructor(
    private readonly ctx: StepContext,
    private readonly plan: Plan,
    private readonly checkReleased: (db: DatabaseSync) => Promise<void>,
    archiveDirectory: string,
  ) {
    for (const patch of plan.metadata)
      assert(
        (patch.table === "tool_call" &&
          ["tool_name", "interaction"].includes(patch.column)) ||
          (patch.table === "conversation_event" && patch.column === "payload"),
        "Invalid metadata patch slot",
      );
    safePath(ctx.paths.sqlitePath);
    assert(
      existsSync(ctx.paths.sqlitePath),
      "Released database is missing; refusing to create an empty replacement",
    );
    this.db = new DatabaseSync(ctx.paths.sqlitePath);
    const directory = join(archiveDirectory, "database");
    this.backupPath = join(directory, "original.sqlite");
    this.backupReceipt = join(directory, "receipt.json");
  }
  state(): "released" | "converted" {
    const legacy = this.db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name='conversation_config'",
      )
      .get();
    if (legacy) {
      assert(
        this.db
          .prepare("PRAGMA table_info(conversation_config)")
          .all()
          .some((row) => row.name === "model"),
        "Intermediate conversation_config is unsupported",
      );
      assert(
        !this.db
          .prepare("SELECT version FROM schema_migrations WHERE version=2")
          .get(),
        "Released table conflicts with converted ledger",
      );
      return "released";
    }
    assert.deepEqual(
      this.db
        .prepare("PRAGMA table_info(conversation)")
        .all()
        .map((row) => row.name),
      [
        "id",
        "project_id",
        "parent_conversation_id",
        "parent_tool_call_id",
        "head_event_id",
        "title",
        "status",
        "status_event_sequence",
        "status_cleared_at",
        "paused",
        "next_input_sequence",
        "pinned_at",
        "completed_at",
        "last_user_message_at",
        "created_at",
        "updated_at",
        "working_directory",
      ],
    );
    assert.equal(
      this.db
        .prepare("SELECT checksum FROM schema_migrations WHERE version=2")
        .get()?.checksum,
      sha256(v2.sql),
      "Unattributed SQL schema change",
    );
    return "converted";
  }
  private backupIO(): DatabaseBackupIO {
    return {
      read(path) {
        safePath(path);
        return existsSync(path) ? readFileSync(path) : undefined;
      },
      write: writeProtected,
      remove(path) {
        safePath(path);
        rmSync(path, { force: true });
      },
      snapshot: async (temporary) => {
        chmodSync(dirname(temporary), 0o700);
        syncDirectory(dirname(temporary));
        await backup(this.db, temporary);
      },
      sync(temporary) {
        chmodSync(temporary, 0o600);
        syncFile(temporary);
      },
      install(temporary, target) {
        renameWithRetrySync(temporary, target);
        syncDirectory(dirname(target));
      },
    };
  }
  async preserveDatabase(): Promise<void> {
    await preserveDatabaseBackup(this.backupIO(), {
      receiptPath: this.backupReceipt,
      target: this.backupPath,
      planDigest: sha256(jsonBytes(this.plan)),
      temporary: () => this.backupPath + "." + randomUUID() + ".tmp",
    });
  }
  verifyBackup(): void {
    verifyDatabaseBackup(
      this.backupIO(),
      this.backupReceipt,
      this.backupPath,
      sha256(jsonBytes(this.plan)),
    );
  }
  async verifyReleased(): Promise<void> {
    await this.checkReleased(this.db);
  }
  begin(): void {
    this.db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
  }
  metadata(): void {
    for (const patch of this.plan.metadata) {
      assert(
        (patch.table === "tool_call" &&
          ["tool_name", "interaction"].includes(patch.column)) ||
          (patch.table === "conversation_event" && patch.column === "payload"),
        "Invalid metadata patch slot",
      );
      const before = this.db
        .prepare(
          `SELECT ${patch.column} AS value FROM ${patch.table} WHERE id=?`,
        )
        .get(patch.id)?.value;
      assert.equal(typeof before, "string");
      assert.equal(
        sha256(String(before)),
        patch.beforeDigest,
        "Stored metadata changed before commit",
      );
      this.db
        .prepare(`UPDATE ${patch.table} SET ${patch.column}=? WHERE id=?`)
        .run(patch.after, patch.id);
    }
  }
  rebuild(): void {
    this.db.exec(v2.sql);
  }
  trust(): void {
    const consumed = new Set(
      this.plan.trust.flatMap((target) => target.sourceIds),
    );
    for (const id of consumed) {
      assert(
        this.plan.sourceTrust.some((source) => source.id === id),
        "Unbound trust deletion",
      );
      this.db.prepare("DELETE FROM trusted_resource WHERE id=?").run(id);
    }
    for (const target of this.plan.trust) {
      assert(target.projectId, "Project trust requires ownership");
      assert(
        !this.plan.sourceTrust.some(
          (source) =>
            source.projectId === target.projectId &&
            source.path === target.path &&
            source.kind === target.kind &&
            !consumed.has(source.id!),
        ),
        "Preexisting target trust identity collision",
      );
      const original = this.plan.sourceTrust.find((source) =>
        target.sourceIds.includes(source.id!),
      );
      this.db
        .prepare(
          `INSERT INTO trusted_resource (id,kind,project_id,path,name,content_digest,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          trustTargetId(target),
          target.kind,
          target.projectId,
          target.path,
          basename(target.path),
          target.contentDigest,
          target.status,
          original?.createdAt ?? this.plan.createdAt,
          this.plan.createdAt,
        );
    }
  }
  recordVersion(): void {
    this.db
      .prepare(
        "INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES (2,?,?,?)",
      )
      .run(v2.name, sha256(v2.sql), this.plan.createdAt);
  }
  foreignKeys(): void {
    assert.deepEqual(
      this.db.prepare("PRAGMA foreign_key_check").all(),
      [],
      "Migration foreign-key check failed",
    );
  }
  async verifyConverted(): Promise<void> {
    await phaseProgress(
      this.ctx,
      "verify-database",
      "Checking updated database",
    )();
    assert.equal(this.state(), "converted");
    const version = this.db
      .prepare(
        "SELECT version,name,checksum,applied_at FROM schema_migrations WHERE version=2",
      )
      .get();
    assert(version, "Converted migration ledger missing");
    assert.deepEqual(
      [version.version, version.name, version.checksum, version.applied_at],
      [2, v2.name, sha256(v2.sql), this.plan.createdAt],
      "Converted migration ledger changed",
    );
    const rows = this.db
      .prepare(
        "SELECT id AS conversation_id,working_directory FROM conversation ORDER BY id",
      )
      .all();
    await verifyConvertedConversationData(
      rows,
      this.plan.sourceRows,
      this.plan.receipts.map((item) => item.receipt),
      {
        read: (path) => (existsSync(path) ? readText(path) : undefined),
      },
      phaseProgress(
        this.ctx,
        "verify-conversations",
        "Verifying conversation settings",
        this.plan.sourceRows.length,
      ),
    );
    for (const patch of this.plan.metadata)
      assert.equal(
        this.db
          .prepare(
            `SELECT ${patch.column} AS value FROM ${patch.table} WHERE id=?`,
          )
          .get(patch.id)?.value,
        patch.after,
      );
    const actual = this.db
      .prepare(
        "SELECT id,kind,project_id,path,content_digest,status,name,created_at,updated_at FROM trusted_resource ORDER BY id",
      )
      .all();
    const consumed = new Set(
      this.plan.trust.flatMap((target) => target.sourceIds),
    );
    const expected = [
      ...this.plan.sourceTrust
        .filter((source) => !consumed.has(source.id!))
        .map((source) => [
          source.id,
          source.kind === "subagent_profile" ? "agent_profile" : source.kind,
          source.projectId ?? null,
          source.path,
          source.contentDigest,
          source.status,
          source.name ?? null,
          source.createdAt,
          source.updatedAt,
        ]),
      ...this.plan.trust.map((target) => [
        trustTargetId(target),
        target.kind,
        target.projectId,
        target.path,
        target.contentDigest,
        target.status,
        basename(target.path),
        this.plan.sourceTrust.find((source) =>
          target.sourceIds.includes(source.id!),
        )?.createdAt ?? this.plan.createdAt,
        this.plan.createdAt,
      ]),
    ].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    assert.deepEqual(
      actual
        .map((row) => [
          row.id,
          row.kind,
          row.project_id,
          row.path,
          row.content_digest,
          row.status,
          row.name,
          row.created_at,
          row.updated_at,
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      expected,
      "Converted trust verification failed",
    );
    await this.verifyUnchangedHistory();
    this.foreignKeys();
  }
  private async verifyUnchangedHistory(): Promise<void> {
    await phaseProgress(
      this.ctx,
      "verify-history",
      "Checking conversation history",
    )();
    const original = new DatabaseSync(this.backupPath, { readOnly: true });
    const reviewed = new DatabaseSync(":memory:");
    try {
      const originalRows = original
        .prepare(
          "SELECT cfg.*,c.parent_conversation_id,c.project_id FROM conversation_config cfg JOIN conversation c ON c.id=cfg.conversation_id ORDER BY cfg.conversation_id",
        )
        .all();
      assert.deepEqual(
        originalRows.map((row) =>
          releasedRowDigest(row as unknown as ReleasedConversation),
        ),
        this.plan.sourceRows.map(releasedRowDigest),
        "Database backup source rows differ from export receipts",
      );
      const names = (db: DatabaseSync) =>
        db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all()
          .map((row) => String(row.name));
      const otherSchema = (db: DatabaseSync) =>
        db
          .prepare(
            "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND type<>'table' ORDER BY type,name",
          )
          .all();
      assert.deepEqual(
        otherSchema(this.db),
        otherSchema(original),
        "Unrelated schema changed during migration",
      );
      const tableSql = (db: DatabaseSync) =>
        db
          .prepare(
            "SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all()
          .map((row) => ({ name: String(row.name), sql: row.sql }));
      const originalTables = tableSql(original);
      const addedTables = reviewedNewTables(originalTables, v2.sql);
      const addedNames = new Set(addedTables.map((table) => table.name));
      assert.deepEqual(
        names(this.db),
        [
          ...names(original).filter((name) => name !== "conversation_config"),
          ...addedNames,
        ].sort(),
        "Unexpected table set changed during migration",
      );
      verifyConvertedTableSql(tableSql(this.db), originalTables, v2.sql);
      for (const table of addedTables) {
        assert.equal(typeof table.sql, "string");
        reviewed.exec(String(table.sql));
        assert.equal(
          this.db
            .prepare("SELECT count(*) AS n FROM " + quote(table.name))
            .get()?.n,
          0,
          "New table must be empty: " + table.name,
        );
      }
      for (const table of names(original)) {
        if (
          [
            "conversation",
            "conversation_config",
            "trusted_resource",
            "schema_migrations",
          ].includes(table)
        )
          continue;
        await this.assertTableMatches(original, table, true);
      }
      const originalConversations = original
        .prepare(
          "SELECT c.*, cfg.working_directory FROM conversation c JOIN conversation_config cfg ON cfg.conversation_id=c.id ORDER BY c.id",
        )
        .all();
      assert.deepEqual(
        this.db.prepare("SELECT * FROM conversation ORDER BY id").all(),
        originalConversations,
        "Released conversation columns changed during rebuild",
      );
      // Complete table SQL above verifies deferral and references. Also retain
      // PRAGMA targets/columns/actions and validate them even for empty tables.
      for (const table of names(this.db)) {
        const pragma = "PRAGMA foreign_key_list(" + quote(table) + ")";
        const links = this.db.prepare(pragma).all();
        assert.deepEqual(
          links,
          (addedNames.has(table) ? reviewed : original).prepare(pragma).all(),
          "Foreign key definitions changed: " + table,
        );
        for (const link of links) {
          assert(
            names(this.db).includes(String(link.table)),
            "Missing foreign-key target: " + link.table,
          );
          assert(
            this.db
              .prepare("PRAGMA table_info(" + quote(String(link.table)) + ")")
              .all()
              .some((column) => column.name === link.to),
            "Missing foreign-key target column",
          );
        }
      }
      const oldVersions = original
        .prepare("SELECT * FROM schema_migrations ORDER BY version")
        .all();
      const versions = this.db
        .prepare("SELECT * FROM schema_migrations ORDER BY version")
        .all();
      assert.deepEqual(
        versions.filter((row) => row.version !== 2),
        oldVersions,
        "Released migration ledger changed",
      );
    } finally {
      reviewed.close();
      original.close();
    }
  }
  commit(): void {
    this.db.exec("COMMIT; PRAGMA foreign_keys=ON");
  }
  rollback(): void {
    if (this.db.isTransaction) this.db.exec("ROLLBACK");
    this.db.exec("PRAGMA foreign_keys=ON");
  }
  private async assertTableMatches(
    original: DatabaseSync,
    table: string,
    applyPatches: boolean,
  ): Promise<void> {
    const keys = original
      .prepare("PRAGMA table_info(" + quote(table) + ")")
      .all()
      .filter((column) => Number(column.pk) > 0)
      .sort((a, b) => Number(a.pk) - Number(b.pk))
      .map((column) => quote(String(column.name)));
    const sql =
      "SELECT * FROM " +
      quote(table) +
      " ORDER BY " +
      (keys.length ? keys.join(",") : "rowid");
    const total = Number(
      original.prepare("SELECT count(*) AS n FROM " + quote(table)).get()?.n,
    );
    const progress = phaseProgress(
      this.ctx,
      "verify-history-" + table,
      "Checking conversation history",
      total,
    );
    await progress();
    let done = 0;
    const actual = this.db.prepare(sql).iterate();
    const patches = new Map<string, Plan["metadata"]>();
    if (applyPatches)
      for (const patch of this.plan.metadata.filter(
        (patch) => patch.table === table,
      )) {
        const list = patches.get(patch.id) ?? [];
        list.push(patch);
        patches.set(patch.id, list);
      }
    try {
      for (const row of original.prepare(sql).iterate()) {
        for (const patch of patches.get(String(row.id)) ?? []) {
          assert.equal(
            sha256(String(row[patch.column])),
            patch.beforeDigest,
            "Backup metadata source changed",
          );
          row[patch.column] = patch.after;
        }
        const next = actual.next();
        assert(!next.done, "History row disappeared: " + table);
        assert.deepEqual(
          next.value,
          row,
          "Unrelated lifecycle/history changed: " + table,
        );
        await progress(++done);
      }
      assert(actual.next().done, "Unexpected history rows: " + table);
    } finally {
      actual.return?.();
    }
  }
  async assertRollbackSafe(): Promise<void> {
    this.verifyBackup();
    if (this.state() === "converted") {
      await this.verifyConverted();
      return;
    }
    const original = new DatabaseSync(this.backupPath, { readOnly: true });
    try {
      const schema = (db: DatabaseSync) =>
        db
          .prepare(
            "SELECT name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name",
          )
          .all();
      assert.deepEqual(
        schema(this.db),
        schema(original),
        "Database schema changed since backup",
      );
      for (const table of original
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .all())
        await this.assertTableMatches(original, String(table.name), false);
    } finally {
      original.close();
    }
  }
  close(): void {
    this.db.close();
  }
}
/** Storage lock held; all SQLite handles must be closed before file replacement. */
export async function restoreReleasedDatabase(
  ctx: StepContext,
  plan: Plan,
  archiveDirectory: string,
): Promise<void> {
  const directory = join(archiveDirectory, "database");
  const path = join(directory, "original.sqlite"),
    receiptPath = join(directory, "receipt.json");
  if (!existsSync(receiptPath)) return;
  const receipt = databaseBackupReceiptSchema.parse(json(receiptPath));
  assert.equal(
    receipt.planDigest,
    sha256(jsonBytes(plan)),
    "Rollback plan does not own database backup",
  );
  if (receipt.phase === "planned") return;
  assert.equal(receipt.phase, "ready");
  const checker = new ReleasedSqliteBackend(
    ctx,
    plan,
    async () => {},
    archiveDirectory,
  );
  try {
    // No committed schema change means there is no DB replacement to undo.
    // Keep later legacy history/choices intact rather than copying an older DB.
    if (checker.state() === "released") return;
    await checker.assertRollbackSafe();
    const checkpoint = checker.db
      .prepare("PRAGMA wal_checkpoint(TRUNCATE)")
      .get();
    assert.equal(checkpoint?.busy, 0, "Rollback database checkpoint is busy");
  } finally {
    checker.close();
  }
  const bytes = readFileSync(path);
  assert.equal(sha256(bytes), receipt.digest);
  for (const suffix of ["-wal", "-shm"])
    rmSync(ctx.paths.sqlitePath + suffix, { force: true });
  writeProtected(ctx.paths.sqlitePath, bytes);
}

const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
