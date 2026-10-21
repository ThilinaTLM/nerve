import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { openCoreDatabase, type CoreDatabase } from "./database.js";
import { coreSchemaV1 } from "./schema.js";
import { coreMigrations, migrate } from "./migrations.js";

const checksum = (sql: string) =>
  createHash("sha256").update(sql).digest("hex");
function seedV1(db: CoreDatabase): void {
  db.sqlite.exec(`CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL
    ) STRICT;`);
  db.sqlite.exec(coreSchemaV1);
  db.sqlite
    .prepare("INSERT INTO schema_migrations VALUES (1, ?, ?, 'original')")
    .run(coreMigrations[0].name, checksum(coreSchemaV1));
  db.sqlite
    .exec(`INSERT INTO project VALUES ('p','Project','/project','now','now');
    INSERT INTO conversation (id,project_id,title,status,status_event_sequence,paused,next_input_sequence,created_at,updated_at)
      VALUES ('c','p','Conversation','idle',0,0,1,'now','now');
    INSERT INTO conversation_config VALUES ('c','{"provider":"test","modelId":"model"}','high','system','instructions','planning','planning','/project');
    INSERT INTO trusted_resource VALUES ('trust','subagent_profile','p','/profiles.json','Review','digest','trusted','now','now');`);
}
function schema(db: CoreDatabase) {
  return db.sqlite
    .prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name",
    )
    .all();
}

test("released v1 upgrades intact to v2; fresh and upgraded schemas are identical", () => {
  assert.equal(
    checksum(coreSchemaV1),
    "2342e3fd7f060d11b8ab99fea3d6f1cf608ce4c2b608ca9763b3a7028946d03c",
  );
  const upgraded = openCoreDatabase(":memory:");
  const fresh = openCoreDatabase(":memory:");
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
          "SELECT version, checksum FROM schema_migrations ORDER BY version",
        )
        .all()
        .map((r) => ({ ...r })),
      coreMigrations.map((m) => ({
        version: m.version,
        checksum: checksum(m.sql),
      })),
    );
    assert.equal(
      upgraded.sqlite
        .prepare("SELECT agent_profile FROM conversation_config")
        .get()?.agent_profile,
      "planning",
    );
    assert.equal(
      upgraded.sqlite
        .prepare("SELECT instructions FROM conversation_config")
        .get()?.instructions,
      "instructions",
    );
    assert.equal(
      upgraded.sqlite.prepare("SELECT kind FROM trusted_resource").get()?.kind,
      "agent_profile",
    );
    upgraded.sqlite.exec(
      "UPDATE conversation_config SET agent_profile = 'custom-lead'",
    );
    assert.throws(
      () =>
        upgraded.sqlite.exec(
          "UPDATE trusted_resource SET kind='subagent_profile'",
        ),
      /CHECK/,
    );
    assert.throws(
      () =>
        upgraded.sqlite.exec(
          "UPDATE conversation_config SET conversation_id='missing'",
        ),
      /FOREIGN KEY/,
    );
    assert.throws(
      () =>
        upgraded.sqlite.exec(
          "UPDATE conversation_config SET model='invalid-json'",
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
      upgraded.sqlite
        .prepare("SELECT count(*) AS n FROM conversation_config")
        .get()?.n,
      0,
    );
    assert.equal(
      upgraded.sqlite
        .prepare("SELECT count(*) AS n FROM trusted_resource")
        .get()?.n,
      0,
    );
  } finally {
    upgraded.close();
    fresh.close();
  }
});

test("v2 preserves additional indexes, triggers and views through column rename", () => {
  const db = openCoreDatabase(":memory:");
  try {
    seedV1(db);
    db.sqlite
      .exec(`CREATE INDEX custom_config_mode ON conversation_config(mode);
      CREATE INDEX custom_trust_status ON trusted_resource(status);
      CREATE TABLE audit (value TEXT) STRICT;
      CREATE TRIGGER config_audit AFTER UPDATE OF mode ON conversation_config BEGIN INSERT INTO audit VALUES (NEW.mode); END;
      CREATE TRIGGER trust_audit AFTER UPDATE OF status ON trusted_resource BEGIN INSERT INTO audit VALUES (NEW.status); END;
      CREATE VIEW profile_view AS SELECT mode FROM conversation_config;`);
    migrate(db);
    assert.match(
      String(
        db.sqlite
          .prepare(
            "SELECT sql FROM sqlite_schema WHERE name='custom_config_mode'",
          )
          .get()?.sql,
      ),
      /agent_profile/,
    );
    db.sqlite.exec(
      "UPDATE conversation_config SET agent_profile='custom'; UPDATE trusted_resource SET status='rejected'",
    );
    assert.deepEqual(
      db.sqlite
        .prepare("SELECT value FROM audit")
        .all()
        .map((r) => r.value),
      ["custom", "rejected"],
    );
    assert.equal(
      db.sqlite.prepare("SELECT agent_profile FROM profile_view").get()
        ?.agent_profile,
      "custom",
    );
  } finally {
    db.close();
  }
});

test("failed checksums and FK checks roll back and restore enforcement", () => {
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
    assert.throws(() => migrate(db), /foreign key check failed/);
    assert.equal(
      db.sqlite.prepare("SELECT mode FROM conversation_config").get()?.mode,
      "planning",
    );
    assert.equal(
      db.sqlite.prepare("SELECT count(*) AS n FROM schema_migrations").get()?.n,
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
