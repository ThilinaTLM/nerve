import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  initializeStorage,
  storagePaths,
} from "../../../src/infrastructure/storage-bootstrap/index.js";
import { CANONICAL_MIGRATIONS } from "../../../src/infrastructure/persistence/canonical-sqlite/schema.js";

// Model a genuinely managed v7 home: neither index nor either v8 receipt exists.
test("managed v7 startup applies v8 and both ledgers atomically, then reopens unchanged", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-managed-v7-index-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const initial = await initializeStorage(home);
  await initial.canonicalStore.close();
  const path = storagePaths(home).sqlitePath;
  const older = new DatabaseSync(path);
  older.exec(`DROP INDEX conversation_records_initial_input_lookup;
    DELETE FROM schema_migrations WHERE version = 8;
    DELETE FROM storage_migrations WHERE id = '0012-run-initial-input-lookup';`);
  const oldLedger = older
    .prepare("SELECT * FROM schema_migrations ORDER BY version")
    .all();
  older.close();
  let receipts: unknown;
  for (let opening = 0; opening < 2; opening++) {
    const storage = await initializeStorage(home);
    assert.equal(
      await storage.canonicalStore.findRunByInitialInputId(
        "agent_missing",
        "input_missing",
      ),
      undefined,
    );
    await storage.canonicalStore.close();
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const ledger = db
        .prepare("SELECT * FROM schema_migrations ORDER BY version")
        .all();
      assert.deepEqual(ledger.slice(0, 7), oldLedger);
      assert.equal(ledger.length, 8);
      assert.equal(
        ledger[7]?.checksum,
        CANONICAL_MIGRATIONS.find((migration) => migration.version === 8)!
          .checksum,
      );
      assert.equal(
        db
          .prepare(
            "SELECT origin FROM storage_migrations WHERE id = '0012-run-initial-input-lookup'",
          )
          .get()?.origin,
        "applied",
      );
      assert.ok(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name = 'conversation_records_initial_input_lookup'",
          )
          .get(),
      );
      if (opening === 0) receipts = ledger;
      else assert.deepEqual(ledger, receipts);
    } finally {
      db.close();
    }
  }
});

test("failed managed v8 index build leaves source schema and both ledgers at v7", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-managed-v7-invalid-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const initial = await initializeStorage(home);
  await initial.canonicalStore.close();
  const path = storagePaths(home).sqlitePath;
  const older = new DatabaseSync(path);
  older.exec(`DROP INDEX conversation_records_initial_input_lookup;
    DELETE FROM schema_migrations WHERE version = 8;
    DELETE FROM storage_migrations WHERE id = '0012-run-initial-input-lookup';`);
  older
    .prepare(`INSERT INTO conversation_records
    (id, conversation_id, agent_id, run_id, sequence, revision, kind, status, payload_version, data, created_at_ms, updated_at_ms)
    VALUES ('run_invalid', 'conv_invalid', 'agent_invalid', 'run_invalid', 1, 1, 'run', 'failed', 1, ?, 0, 0)`)
    .run(Buffer.from("malformed-json"));
  const before = older
    .prepare("SELECT * FROM schema_migrations ORDER BY version")
    .all();
  older.close();
  await assert.rejects(initializeStorage(home), /malformed JSON/);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    assert.deepEqual(
      db.prepare("SELECT * FROM schema_migrations ORDER BY version").all(),
      before,
    );
    assert.equal(
      db
        .prepare(
          "SELECT id FROM storage_migrations WHERE id = '0012-run-initial-input-lookup'",
        )
        .get(),
      undefined,
    );
    assert.equal(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name = 'conversation_records_initial_input_lookup'",
        )
        .get(),
      undefined,
    );
    assert.deepEqual(
      db
        .prepare(
          "SELECT data FROM conversation_records WHERE id = 'run_invalid'",
        )
        .get()?.data,
      new Uint8Array(Buffer.from("malformed-json")),
    );
  } finally {
    db.close();
  }
});
