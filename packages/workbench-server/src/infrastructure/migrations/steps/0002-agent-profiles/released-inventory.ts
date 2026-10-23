import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { coreMigrations } from "@nervekit/conversation-core";
import type { StepContext } from "../../framework/step.js";
import { safePath } from "./files.js";
import { sha256 } from "./released-format.js";
import { planMetadata } from "./released-metadata.js";
import type { OriginalTrust } from "./released-export.js";

export function inventory(ctx: StepContext, connection?: DatabaseSync) {
  safePath(ctx.paths.sqlitePath);
  const db =
    connection ?? new DatabaseSync(ctx.paths.sqlitePath, { readOnly: true });
  try {
    const columns = db
      .prepare("PRAGMA table_info(conversation_config)")
      .all()
      .map((row) => row.name);
    assert.deepEqual(
      columns,
      [
        "conversation_id",
        "model",
        "reasoning_level",
        "system_prompt",
        "instructions",
        "permission_rule_set_id",
        "mode",
        "working_directory",
      ],
      "Migration requires released v0.37.0 SQL, not intermediate/custom state",
    );
    const dependencies = db
      .prepare(
        "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND type IN ('index','trigger','view')",
      )
      .all();
    for (const dependency of dependencies) {
      const touchesRebuilt =
        dependency.tbl_name === "conversation" ||
        dependency.tbl_name === "conversation_config" ||
        dependency.tbl_name === "trusted_resource" ||
        /\b(conversation|conversation_config|trusted_resource)\b/i.test(
          String(dependency.sql),
        );
      assert(
        !touchesRebuilt ||
          (dependency.type === "index" &&
            [
              "trusted_resource_project_path",
              "trusted_resource_user_path",
              "conversation_project_parent_updated",
              "conversation_parent",
              "conversation_pinned",
            ].includes(String(dependency.name))),
        `Unsupported SQL dependency on rebuilt tables: ${dependency.name}`,
      );
    }
    const normalizeSql = (sql: string) =>
      sql.replaceAll('"', "").replace(/\s+/g, " ").replace(/;$/, "").trim();
    const v1 = coreMigrations.find((migration) => migration.version === 1)!;
    assert.equal(
      db.prepare("SELECT checksum FROM schema_migrations WHERE version=1").get()
        ?.checksum,
      sha256(v1.sql),
      "Released SQL checksum mismatch",
    );
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM schema_migrations").get()?.n,
      1,
      "Not released SQL v1",
    );
    for (const table of [
      "conversation",
      "conversation_config",
      "trusted_resource",
    ]) {
      const start = v1.sql.indexOf("CREATE TABLE " + table + " (");
      const end = v1.sql.indexOf(") STRICT;", start) + ") STRICT;".length;
      assert(start >= 0 && end > start);
      const actual = db
        .prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?")
        .get(table)?.sql;
      assert.equal(
        normalizeSql(String(actual)),
        normalizeSql(v1.sql.slice(start, end)),
        "Custom SQL definition requires review before rebuild",
      );
    }
    for (const index of [
      "trusted_resource_project_path",
      "trusted_resource_user_path",
      "conversation_project_parent_updated",
      "conversation_parent",
      "conversation_pinned",
    ]) {
      const start = v1.sql.indexOf(
          (index.startsWith("trusted_resource_")
            ? "CREATE UNIQUE INDEX "
            : "CREATE INDEX ") +
            index +
            " ",
        ),
        end = v1.sql.indexOf(";", start);
      assert.equal(
        normalizeSql(
          String(
            db
              .prepare(
                "SELECT sql FROM sqlite_schema WHERE type='index' AND name=?",
              )
              .get(index)?.sql,
          ),
        ),
        normalizeSql(v1.sql.slice(start, end)),
        "Custom trust index requires review",
      );
    }
    const projects = db
      .prepare("SELECT id, directory FROM project ORDER BY id")
      .all();
    const rows = db
      .prepare(
        `SELECT cfg.*, c.parent_conversation_id, c.project_id FROM conversation_config cfg JOIN conversation c ON c.id=cfg.conversation_id ORDER BY cfg.conversation_id`,
      )
      .all();
    assert.equal(
      rows.length,
      db.prepare("SELECT count(*) AS n FROM conversation").get()?.n,
      "Missing conversation configuration row",
    );
    assert.equal(
      rows.length,
      db.prepare("SELECT count(*) AS n FROM conversation_config").get()?.n,
      "Unexported/orphan conversation config row",
    );
    assert.deepEqual(
      db.prepare("PRAGMA foreign_key_check").all(),
      [],
      "Released database has broken foreign keys",
    );
    const trust: OriginalTrust[] = db
      .prepare(
        "SELECT id,name,created_at,updated_at,project_id,kind,path,content_digest,status FROM trusted_resource ORDER BY id",
      )
      .all()
      .map((row) => ({
        id: String(row.id),
        name: row.name === null ? null : String(row.name),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        projectId: row.project_id === null ? null : String(row.project_id),
        kind: String(row.kind),
        path: String(row.path),
        contentDigest: String(row.content_digest),
        status: row.status === "trusted" ? "trusted" : "rejected",
      }));
    const metadata = planMetadata({
      events: db
        .prepare(
          "SELECT id,payload FROM conversation_event WHERE instr(payload, 'plan_mode_present') > 0",
        )
        .all()
        .map((row) => ({ id: String(row.id), payload: String(row.payload) })),
      calls: db
        .prepare(
          "SELECT id,tool_name,interaction FROM tool_call WHERE tool_name='plan_mode_present' OR interaction IS NOT NULL",
        )
        .all()
        .map((row) => ({
          id: String(row.id),
          toolName: String(row.tool_name),
          interaction:
            row.interaction === null ? null : String(row.interaction),
        })),
    });
    return { projects, rows, trust, metadata };
  } finally {
    if (!connection) db.close();
  }
}
