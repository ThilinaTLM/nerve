import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { CanonicalStore } from "../src/infrastructure/canonical-store/index.js";
import {
  CANONICAL_SCHEMA_CHECKSUM,
  CANONICAL_SCHEMA_SQL,
  CANONICAL_SCHEMA_V1_CHECKSUM,
  CANONICAL_SCHEMA_VERSION,
} from "../src/infrastructure/canonical-store/schema.js";

test("canonical schema checksum matches the v2 SQL", () => {
  assert.equal(
    createHash("sha256").update(CANONICAL_SCHEMA_SQL).digest("hex"),
    CANONICAL_SCHEMA_CHECKSUM,
  );
});

test("fresh canonical stores use v2 without removed tables", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-v2-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const path = join(home, "data", "nerve.sqlite");
  const store = new CanonicalStore(path);
  await store.initialize();
  await store.close();

  const database = new DatabaseSync(path, { readOnly: true });
  const objects = database
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE name IN (
         'canonical_meta', 'permission_rules', 'permission_rules_scope_tool'
       ) ORDER BY name`,
    )
    .all();
  const versions = (
    database
      .prepare(`SELECT version FROM schema_migrations ORDER BY version`)
      .all() as Array<{ version: number }>
  ).map((row) => row.version);
  database.close();
  assert.deepEqual(objects, []);
  assert.deepEqual(versions, [CANONICAL_SCHEMA_VERSION]);
});

test("canonical v1 stores migrate transactionally to v2", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-v1-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const path = join(home, "nerve.sqlite");
  const database = new DatabaseSync(path);
  database.exec(CANONICAL_SCHEMA_SQL);
  database.exec(`
    CREATE TABLE canonical_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE permission_rules (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      project_id TEXT,
      effect TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      matcher_kind TEXT NOT NULL,
      pattern TEXT NOT NULL,
      source_digest TEXT,
      enabled INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX permission_rules_scope_tool
      ON permission_rules(scope, project_id, tool_name, enabled);
  `);
  database
    .prepare(
      `INSERT INTO schema_migrations
       (version, name, checksum, applied_at_ms, duration_ms)
       VALUES (1, 'canonical-baseline', ?, 1, 0)`,
    )
    .run(CANONICAL_SCHEMA_V1_CHECKSUM);
  database
    .prepare(
      `INSERT INTO domain_documents (
         namespace, scope_id, document_id, revision, payload_version, data,
         created_at_ms, updated_at_ms
       ) VALUES ('test', 'global', 'preserved', 1, 1, ?, 1, 1)`,
    )
    .run(Buffer.from(JSON.stringify({ preserved: true })));
  database.close();

  const store = new CanonicalStore(path);
  await store.initialize();
  await store.close();

  const migrated = new DatabaseSync(path, { readOnly: true });
  const objects = migrated
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE name IN (
         'canonical_meta', 'permission_rules', 'permission_rules_scope_tool'
       ) ORDER BY name`,
    )
    .all();
  const versions = (
    migrated
      .prepare(`SELECT version FROM schema_migrations ORDER BY version`)
      .all() as Array<{ version: number }>
  ).map((row) => row.version);
  const documents = migrated
    .prepare(`SELECT COUNT(*) AS count FROM domain_documents`)
    .get() as { count: number };
  migrated.close();
  assert.deepEqual(objects, []);
  assert.deepEqual(versions, [1, 2]);
  assert.equal(documents.count, 1);
});

test("canonical documents use revision compare-and-swap", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-store-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const store = new CanonicalStore(join(home, "data", "nerve.sqlite"));
  await store.initialize();
  const first = await store.writeDocument({
    namespace: "test",
    scopeId: "global",
    documentId: "one",
    data: { value: 1 },
    expectedRevision: 0,
  });
  assert.equal(first.revision, 1);
  await assert.rejects(
    store.writeDocument({
      namespace: "test",
      scopeId: "global",
      documentId: "one",
      data: { value: 2 },
      expectedRevision: 0,
    }),
    /revision conflict/i,
  );
  await store.close();
});

test("canonical events are dense per stream and idempotent by durable intent", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-events-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const store = new CanonicalStore(join(home, "data", "nerve.sqlite"));
  await store.initialize();
  const input = {
    stream: "workspace",
    intentId: "evt_canonical_test",
    eventType: "test.event",
    data: { value: 1 },
    occurredAt: "2026-08-24T00:00:00.000Z",
  };
  const first = await store.appendDurableEvent(input);
  await store.appendDurableEvent({
    ...input,
    stream: "conv/public",
    intentId: "evt_public_1",
  });
  const second = await store.appendDurableEvent({
    ...input,
    intentId: "evt_workspace_2",
  });
  await store.appendDurableEvent({
    ...input,
    stream: "internal/conv/public",
    intentId: "evt_internal_1",
  });
  const third = await store.appendDurableEvent({
    ...input,
    intentId: "evt_workspace_3",
  });

  assert.deepEqual(
    [first.sequence, second.sequence, third.sequence],
    [1, 2, 3],
  );
  assert.deepEqual(
    (await store.readDurableEvents("workspace", 1, 10)).map(
      (event) => event.sequence,
    ),
    [1, 2, 3],
  );
  assert.deepEqual(await store.durableEventBounds("workspace"), {
    stream: "workspace",
    earliestAvailableSeq: 1,
    latestSeq: 3,
  });
  assert.deepEqual(await store.appendDurableEvent(input), first);
  await assert.rejects(
    store.appendDurableEvent({ ...input, data: { value: 2 } }),
    /conflicting event intent/i,
  );
  await assert.rejects(
    store.appendDurableEvent({ ...input, stream: "conv/conflict" }),
    /conflicting event intent/i,
  );

  await store.removeDurableEventStream("workspace");
  const recreated = await store.appendDurableEvent({
    ...input,
    intentId: "evt_workspace_recreated",
  });
  assert.equal(recreated.sequence, 4);
  assert.deepEqual(await store.durableEventBounds("workspace"), {
    stream: "workspace",
    earliestAvailableSeq: 4,
    latestSeq: 4,
  });
  await store.close();
});

test("newer SQLite schemas are refused", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-version-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const path = join(home, "data", "nerve.sqlite");
  const store = new CanonicalStore(path);
  await store.initialize();
  await store.close();
  const database = new DatabaseSync(path);
  database
    .prepare(
      `INSERT INTO schema_migrations
       (version, name, checksum, applied_at_ms, duration_ms)
       VALUES (4, 'future', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 1, 0)`,
    )
    .run();
  database.close();
  const future = new CanonicalStore(path);
  await assert.rejects(future.initialize(), /newer than supported/i);
  await future.close();
});

test("checksum-drifted v1 schemas are refused before migration", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-drift-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const path = join(home, "nerve.sqlite");
  const database = new DatabaseSync(path);
  database.exec(CANONICAL_SCHEMA_SQL);
  database
    .prepare(
      `INSERT INTO schema_migrations
       (version, name, checksum, applied_at_ms, duration_ms)
       VALUES (1, 'canonical-baseline', ?, 1, 0)`,
    )
    .run("f".repeat(64));
  database.close();

  const store = new CanonicalStore(path);
  await assert.rejects(store.initialize(), /checksum drift at version 1/i);
  await store.close();
});
