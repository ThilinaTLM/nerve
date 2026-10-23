import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { openCoreDatabase, type CoreDatabase } from "./database.js";
import { coreSchemaV1 } from "./schema.js";
import { coreMigrations, migrate } from "./migrations.js";

const checksum = (sql: string) =>
  createHash("sha256").update(sql).digest("hex");
function seedV1(db: CoreDatabase, populated = false): void {
  db.sqlite.exec(`CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL
    ) STRICT;`);
  db.sqlite.exec(coreSchemaV1);
  db.sqlite
    .prepare("INSERT INTO schema_migrations VALUES (1, ?, ?, 'original')")
    .run(coreMigrations[0].name, checksum(coreSchemaV1));
  db.sqlite
    .exec(`INSERT INTO project VALUES ('p','Project','/project','now','now');
    INSERT INTO trusted_resource VALUES ('trust','subagent_profile','p','/profiles.json','Review','digest','trusted','now','now');`);
  if (populated)
    db.sqlite
      .exec(`INSERT INTO conversation (id,project_id,title,status,status_event_sequence,paused,next_input_sequence,created_at,updated_at)
    VALUES ('c','p','Conversation','idle',0,0,1,'now','now');
    INSERT INTO conversation_config VALUES ('c','{"provider":"test","modelId":"model"}','high','system','instructions','planning','planning','/project');`);
}
function schema(db: CoreDatabase) {
  return db.sqlite
    .prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name",
    )
    .all();
}

test("empty released core upgrades to the identical fresh D10 schema, preserving trust and the v1 ledger", () => {
  assert.equal(
    checksum(coreSchemaV1),
    "2342e3fd7f060d11b8ab99fea3d6f1cf608ce4c2b608ca9763b3a7028946d03c",
  );
  const upgraded = openCoreDatabase(":memory:"),
    fresh = openCoreDatabase(":memory:");
  try {
    seedV1(upgraded);
    const original = upgraded.sqlite
      .prepare("SELECT * FROM schema_migrations WHERE version=1")
      .get();
    migrate(upgraded);
    migrate(fresh);
    assert.deepEqual(schema(upgraded), schema(fresh));
    assert.deepEqual(
      upgraded.sqlite
        .prepare("SELECT * FROM schema_migrations WHERE version=1")
        .get(),
      original,
    );
    assert.deepEqual(
      upgraded.sqlite
        .prepare(
          "SELECT version,checksum FROM schema_migrations ORDER BY version",
        )
        .all()
        .map((row) => ({ ...row })),
      coreMigrations.map((migration) => ({
        version: migration.version,
        checksum: checksum(migration.sql),
      })),
    );
    assert.equal(
      upgraded.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='conversation_config'",
        )
        .get(),
      undefined,
    );
    assert.equal(
      upgraded.sqlite
        .prepare("PRAGMA table_info(conversation)")
        .all()
        .find((column) => column.name === "working_directory")?.notnull,
      1,
    );
    assert.equal(
      upgraded.sqlite.prepare("SELECT kind FROM trusted_resource").get()?.kind,
      "agent_profile",
    );
    assert.throws(
      () =>
        upgraded.sqlite.exec(
          "UPDATE trusted_resource SET kind='subagent_profile'",
        ),
      /CHECK/,
    );
    assert.deepEqual(
      upgraded.sqlite.prepare("PRAGMA foreign_key_check").all(),
      [],
    );
    assert.equal(
      upgraded.sqlite.prepare("PRAGMA foreign_keys").get()?.foreign_keys,
      1,
    );
    migrate(upgraded);
    upgraded.sqlite.exec("DELETE FROM project WHERE id='p'");
    assert.equal(
      upgraded.sqlite.prepare("SELECT count(*) n FROM trusted_resource").get()
        ?.n,
      0,
    );
  } finally {
    upgraded.close();
    fresh.close();
  }
});

test("populated released core cannot bypass home export, even with custom affected schema", () => {
  const db = openCoreDatabase(":memory:");
  try {
    seedV1(db, true);
    db.sqlite
      .exec(`CREATE INDEX custom_config_mode ON conversation_config(mode);
      CREATE TABLE audit (value TEXT) STRICT;
      CREATE TRIGGER config_audit AFTER UPDATE OF mode ON conversation_config BEGIN INSERT INTO audit VALUES (NEW.mode); END;
      CREATE VIEW profile_view AS SELECT mode FROM conversation_config;`);
    const before = schema(db);
    assert.throws(
      () => migrate(db),
      /Home migration 0002 must verify agent exports/,
    );
    assert.deepEqual(schema(db), before);
    assert.equal(
      db.sqlite.prepare("SELECT instructions FROM conversation_config").get()
        ?.instructions,
      "instructions",
    );
    assert.equal(
      db.sqlite.prepare("SELECT count(*) n FROM schema_migrations").get()?.n,
      1,
    );
    assert.equal(
      db.sqlite.prepare("PRAGMA foreign_keys").get()?.foreign_keys,
      1,
    );
  } finally {
    db.close();
  }
});

test("failed checksums and FK checks roll back the approved rebuild and restore enforcement", () => {
  const db = openCoreDatabase(":memory:");
  try {
    seedV1(db);
    db.sqlite.exec("UPDATE schema_migrations SET checksum='tampered'");
    assert.throws(() => migrate(db), /checksum mismatch: 1/);
    assert.equal(
      db.sqlite.prepare("PRAGMA foreign_keys").get()?.foreign_keys,
      1,
    );
    db.sqlite
      .prepare("UPDATE schema_migrations SET checksum=?")
      .run(checksum(coreSchemaV1));
    db.sqlite.exec(
      "PRAGMA foreign_keys=OFF; UPDATE trusted_resource SET project_id='missing'; PRAGMA foreign_keys=ON",
    );
    const before = schema(db);
    assert.throws(() => migrate(db), /foreign key check failed/);
    assert.deepEqual(schema(db), before);
    assert.equal(
      db.sqlite.prepare("SELECT kind FROM trusted_resource").get()?.kind,
      "subagent_profile",
    );
    assert.equal(
      db.sqlite.prepare("SELECT count(*) n FROM schema_migrations").get()?.n,
      1,
    );
    assert.equal(
      db.sqlite.prepare("PRAGMA foreign_keys").get()?.foreign_keys,
      1,
    );
  } finally {
    db.close();
  }
});
