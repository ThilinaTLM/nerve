import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  CanonicalStore,
  encode,
} from "../../../src/infrastructure/persistence/canonical-sqlite/index.js";
import {
  CANONICAL_BASELINE_NAME,
  CANONICAL_SCHEMA_CHECKSUM,
  CANONICAL_SCHEMA_SQL,
  CANONICAL_SCHEMA_VERSION,
} from "../../../src/infrastructure/persistence/canonical-sqlite/schema.js";

test("canonical schema checksum matches the v1 baseline SQL", () => {
  assert.equal(
    createHash("sha256").update(CANONICAL_SCHEMA_SQL).digest("hex"),
    CANONICAL_SCHEMA_CHECKSUM,
  );
});

test("fresh canonical stores create the complete v1 baseline directly", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-v1-"));
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
         'canonical_meta', 'permission_rules',
         'conversation_record_projections', 'tool_call_projections',
         'rpc_idempotency'
       ) ORDER BY name`,
    )
    .all()
    .map((row) => String((row as { name: unknown }).name));
  const migrations = database
    .prepare(
      `SELECT version, name, checksum FROM schema_migrations ORDER BY version`,
    )
    .all()
    .map((row) => ({
      version: Number((row as { version: unknown }).version),
      name: String((row as { name: unknown }).name),
      checksum: String((row as { checksum: unknown }).checksum),
    }));
  database.close();

  assert.deepEqual(objects, [
    "conversation_record_projections",
    "rpc_idempotency",
    "tool_call_projections",
  ]);
  assert.deepEqual(migrations, [
    {
      version: CANONICAL_SCHEMA_VERSION,
      name: CANONICAL_BASELINE_NAME,
      checksum: CANONICAL_SCHEMA_CHECKSUM,
    },
  ]);
});

test("current v1 stores reopen without changing data or migration history", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-reopen-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const path = join(home, "data", "nerve.sqlite");
  const first = new CanonicalStore(path);
  await first.initialize();
  await first.writeDocument({
    namespace: "test",
    scopeId: "global",
    documentId: "preserved",
    data: { preserved: true },
    expectedRevision: 0,
  });
  await first.close();

  const second = new CanonicalStore(path);
  await second.initialize();
  assert.deepEqual(
    (
      await second.readDocument<{ preserved: boolean }>(
        "test",
        "global",
        "preserved",
      )
    )?.data,
    { preserved: true },
  );
  await second.close();

  const database = new DatabaseSync(path, { readOnly: true });
  const versions = database
    .prepare(`SELECT version FROM schema_migrations ORDER BY version`)
    .all()
    .map((row) => ({ version: Number((row as { version: unknown }).version) }));
  database.close();
  assert.deepEqual(versions, [{ version: 1 }]);
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

test("unreleased canonical schema versions are refused", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-version-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const path = join(home, "data", "nerve.sqlite");
  const store = new CanonicalStore(path);
  await store.initialize();
  await store.close();
  const database = new DatabaseSync(path);
  database
    .prepare(
      `UPDATE schema_migrations SET version = 6, name = 'development-v6'`,
    )
    .run();
  database.close();
  const future = new CanonicalStore(path);
  await assert.rejects(future.initialize(), /schema 6 is unsupported/i);
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

test("v1 deletion index repair preserves data and ledger and prevents child scans", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-deletion-indexes-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const path = join(home, "nerve.sqlite");
  const seed = new DatabaseSync(path);
  seed.exec(CANONICAL_SCHEMA_SQL);
  seed
    .prepare("INSERT INTO schema_migrations VALUES (?, ?, ?, ?, ?)")
    .run(
      CANONICAL_SCHEMA_VERSION,
      CANONICAL_BASELINE_NAME,
      CANONICAL_SCHEMA_CHECKSUM,
      123,
      456,
    );
  const ledger = seed.prepare("SELECT * FROM schema_migrations").all();
  seed
    .prepare(`INSERT INTO domain_documents VALUES (
    'test', 'global', 'preserved', 1, 1, ?, 123, 123
  )`)
    .run(encode({ value: 42 }));
  seed.close();
  for (let attempt = 0; attempt < 2; attempt++) {
    const store = new CanonicalStore(path);
    await store.initialize();
    assert.deepEqual(
      (await store.readDocument("test", "global", "preserved"))?.data,
      { value: 42 },
    );
    await store.close();
    const database = new DatabaseSync(path);
    database.exec("PRAGMA foreign_keys = ON");
    assert.deepEqual(
      database.prepare("SELECT * FROM schema_migrations").all(),
      ledger,
    );
    const plan = database
      .prepare(
        "EXPLAIN QUERY PLAN DELETE FROM conversation_records WHERE id = ?",
      )
      .all("record")
      .map((row) => String(row.detail))
      .join("\n");
    assert.match(
      plan,
      /SEARCH durable_events USING COVERING INDEX durable_events_record/,
    );
    assert.match(
      plan,
      /SEARCH agent_context_leaves USING COVERING INDEX agent_context_leaves_active_record/,
    );
    assert.doesNotMatch(plan, /SCAN (durable_events|agent_context_leaves)/);
    database.close();
  }
});

test("deletion index repair fails transactionally for an incorrectly named index", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-deletion-index-conflict-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const path = join(home, "nerve.sqlite");
  const seed = new DatabaseSync(path);
  seed.exec(CANONICAL_SCHEMA_SQL);
  seed
    .prepare("INSERT INTO schema_migrations VALUES (?, ?, ?, ?, ?)")
    .run(
      CANONICAL_SCHEMA_VERSION,
      CANONICAL_BASELINE_NAME,
      CANONICAL_SCHEMA_CHECKSUM,
      123,
      0,
    );
  seed.exec(
    "CREATE INDEX durable_events_record ON durable_events(conversation_id)",
  );
  seed.close();
  const store = new CanonicalStore(path);
  await assert.rejects(
    store.initialize(),
    /Canonical deletion index durable_events_record/,
  );
  await store.close();
  const database = new DatabaseSync(path);
  assert.equal(
    database
      .prepare(
        "SELECT name FROM sqlite_master WHERE name = 'agent_context_leaves_active_record'",
      )
      .get(),
    undefined,
  );
  assert.equal(
    database.prepare("SELECT count(*) AS count FROM schema_migrations").get()
      ?.count,
    1,
  );
  database.close();
});
