import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { agentInputQueueStateSchema } from "@nervekit/contracts/agents";
import {
  runRecordSchema,
  runPromptRecordSchema,
} from "@nervekit/contracts/runs";
import { buildTransition } from "../../../src/domains/runs/runtime/index.js";
import {
  CanonicalStore,
  encode,
} from "../../../src/infrastructure/persistence/canonical-sqlite/index.js";
import {
  CANONICAL_BASELINE_CHECKSUM,
  CANONICAL_BASELINE_NAME,
  CANONICAL_BASELINE_VERSION,
  CANONICAL_MIGRATIONS,
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

test("canonical migration checksums match their immutable SQL", () => {
  for (const migration of CANONICAL_MIGRATIONS) {
    assert.equal(
      createHash("sha256").update(migration.sql).digest("hex"),
      migration.checksum,
      migration.name,
    );
  }
});

test("fresh canonical stores create the baseline and ordered migrations", async (t) => {
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
         'rpc_idempotency', 'lifecycle_work',
         'lifecycle_command_receipts', 'reconciliation_operations',
         'run_lifecycle_records', 'lifecycle_tool_proposals',
         'lifecycle_interactions', 'lifecycle_execution_attempts',
         'lifecycle_recovery_issues'
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
    "lifecycle_command_receipts",
    "lifecycle_execution_attempts",
    "lifecycle_interactions",
    "lifecycle_recovery_issues",
    "lifecycle_tool_proposals",
    "lifecycle_work",
    "reconciliation_operations",
    "rpc_idempotency",
    "run_lifecycle_records",
    "tool_call_projections",
  ]);
  assert.deepEqual(migrations, [
    {
      version: CANONICAL_BASELINE_VERSION,
      name: CANONICAL_BASELINE_NAME,
      checksum: CANONICAL_BASELINE_CHECKSUM,
    },
    ...CANONICAL_MIGRATIONS.map(({ version, name, checksum }) => ({
      version,
      name,
      checksum,
    })),
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
  assert.deepEqual(
    versions,
    Array.from({ length: CANONICAL_SCHEMA_VERSION }, (_, index) => ({
      version: index + 1,
    })),
  );
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
      `UPDATE schema_migrations SET version = ?, name = 'development-next'
       WHERE version = ?`,
    )
    .run(CANONICAL_SCHEMA_VERSION + 1, CANONICAL_SCHEMA_VERSION);
  database.close();
  const future = new CanonicalStore(path);
  await assert.rejects(
    future.initialize(),
    new RegExp(`schema ${CANONICAL_SCHEMA_VERSION + 1} is unsupported`, "i"),
  );
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
      CANONICAL_BASELINE_VERSION,
      CANONICAL_BASELINE_NAME,
      CANONICAL_BASELINE_CHECKSUM,
      123,
      456,
    );
  let ledger: unknown[] | undefined;
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
    const actualLedger = database
      .prepare("SELECT * FROM schema_migrations ORDER BY version")
      .all();
    if (ledger) assert.deepEqual(actualLedger, ledger);
    else ledger = actualLedger;
    assert.equal(actualLedger.length, CANONICAL_SCHEMA_VERSION);
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
      CANONICAL_BASELINE_VERSION,
      CANONICAL_BASELINE_NAME,
      CANONICAL_BASELINE_CHECKSUM,
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
    CANONICAL_SCHEMA_VERSION,
  );
  database.close();
});

test("copied v7 fixture upgrades by index only and reopens without changing authoritative bytes", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-v7-upgrade-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const original = join(home, "v7.sqlite");
  const path = join(home, "copy.sqlite");
  const fixture = new DatabaseSync(original);
  fixture.exec(CANONICAL_SCHEMA_SQL);
  const ledger = fixture.prepare(
    "INSERT INTO schema_migrations VALUES (?, ?, ?, 1, 0)",
  );
  ledger.run(
    CANONICAL_BASELINE_VERSION,
    CANONICAL_BASELINE_NAME,
    CANONICAL_BASELINE_CHECKSUM,
  );
  for (const migration of CANONICAL_MIGRATIONS.filter(
    (item) => item.version < 8,
  )) {
    fixture.exec(migration.sql);
    ledger.run(migration.version, migration.name, migration.checksum);
  }
  const timestamp = "2026-10-08T00:00:00.000Z";
  const selected = runRecordSchema.parse({
    runId: "run_preserved",
    conversationId: "conv_preserved",
    agentId: "agent_preserved",
    scopeId: "conv_preserved:agent_preserved",
    initialInputId: "input_preserved",
    stateEpoch: 1,
    projectId: "proj_preserved",
    revision: 3,
    status: "completed",
    recoverability: "none",
    executionId: "exec_preserved",
    attempt: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    terminalAt: timestamp,
    cancellationEvidence: [],
  });
  const insert = fixture.prepare(`INSERT INTO conversation_records
    (id, conversation_id, agent_id, run_id, sequence, revision, kind, status,
     payload_version, data, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, 3, 'run', 'completed', 1, ?, 1, 2)`);
  for (let index = 0; index < 128; index++) {
    const run =
      index === 0
        ? selected
        : runRecordSchema.parse({
            ...selected,
            runId: `run_history_${index}`,
            initialInputId: `input_history_${index}`,
            agentId: `agent_history_${index % 16}`,
            conversationId: `conv_history_${index % 16}`,
            scopeId: `conv_history_${index % 16}:agent_history_${index % 16}`,
          });
    const prompt = runPromptRecordSchema.parse({
      id: `promptq_history_${index}`,
      agentId: run.agentId,
      conversationId: run.conversationId,
      projectId: run.projectId,
      runId: run.runId,
      behavior: "steer",
      status: "delivered",
      text: "retained fixture content ".repeat(
        Math.ceil((index === 0 ? 1024 * 1024 : 64 * 1024) / 25),
      ),
      createdAt: timestamp,
      updatedAt: timestamp,
      ordinal: 0,
      deliveryAttempts: 1,
    });
    const transition = buildTransition(
      run,
      "completed",
      2,
      { prompts: [prompt] },
      { next: () => `history_${index}` },
      { checksum: () => `sha256:${"0".repeat(64)}` },
    );
    insert.run(
      run.runId,
      run.conversationId,
      run.agentId,
      run.runId,
      index + 1,
      encode({
        run,
        state: {
          run,
          prompts: [prompt],
          transitions: [transition],
          interactions: [],
          checkpoints: [],
          deliveries: [],
        },
      }),
    );
  }
  const retainedBytes = Number(
    fixture
      .prepare("SELECT sum(length(data)) AS bytes FROM conversation_records")
      .get()?.bytes,
  );
  assert.ok(retainedBytes >= 8 * 1024 * 1024);
  // Schema-valid accepted queue and exact delivery receipt: this test claims byte
  // preservation only, not queue execution or delivery behavior.
  const queue = agentInputQueueStateSchema.parse({
    revision: 4,
    nextSequence: 2,
    paused: false,
    inputs: [
      {
        id: "input_preserved",
        sequence: 0,
        agentId: selected.agentId,
        conversationId: selected.conversationId,
        idempotencyKey: "preserved",
        origin: { kind: "user", userId: "user_fixture" },
        role: "user",
        text: "retained assignment",
        eligibility: { kind: "next_turn" },
        activation: "wake_if_idle",
        acceptedAt: timestamp,
        state: "delivered",
        delivery: {
          runId: selected.runId,
          attemptId: selected.executionId,
          turnId: "turn_preserved",
          contextEntryId: "entry_input_preserved",
          deliveredAt: timestamp,
        },
      },
      {
        id: "input_pending",
        sequence: 1,
        agentId: selected.agentId,
        conversationId: selected.conversationId,
        idempotencyKey: "pending",
        origin: { kind: "user", userId: "user_fixture" },
        role: "user",
        text: "pending assignment",
        eligibility: { kind: "next_turn" },
        activation: "wake_if_idle",
        acceptedAt: timestamp,
        state: "pending",
      },
    ],
  });
  fixture
    .prepare(`INSERT INTO domain_documents
    (namespace, scope_id, document_id, revision, payload_version, data, created_at_ms, updated_at_ms)
    VALUES ('agent_inputs', 'global', 'agent_preserved', 4, 1, ?, 1, 2)`)
    .run(encode(queue));
  const beforeRecords = fixture
    .prepare("SELECT * FROM conversation_records")
    .all();
  const beforeDocuments = fixture
    .prepare(
      "SELECT * FROM domain_documents WHERE namespace = 'agent_inputs' AND scope_id = 'global' AND document_id = 'agent_preserved'",
    )
    .all();
  const beforeLedger = fixture
    .prepare("SELECT * FROM schema_migrations ORDER BY version")
    .all();
  fixture.close();
  await copyFile(original, path);
  for (let opening = 0; opening < 2; opening++) {
    const store = new CanonicalStore(path);
    const started = performance.now();
    await store.initialize();
    const initializeMs = performance.now() - started;
    assert.deepEqual(
      await store.findRunByInitialInputId(
        selected.agentId,
        selected.initialInputId!,
      ),
      selected,
    );
    await store.close();
    const database = new DatabaseSync(path);
    if (opening === 0) {
      const migration = database
        .prepare("SELECT duration_ms FROM schema_migrations WHERE version = 8")
        .get();
      const maintenanceStarted = performance.now();
      database
        .prepare("UPDATE conversation_records SET data = data WHERE id = ?")
        .run(selected.runId);
      t.diagnostic(
        `v8 fixture: ${retainedBytes} authoritative bytes, 128 histories; index build ${migration?.duration_ms}ms; initialization ${initializeMs.toFixed(2)}ms; selected-record index maintenance ${(performance.now() - maintenanceStarted).toFixed(2)}ms`,
      );
    }
    const plan = database
      .prepare(`EXPLAIN QUERY PLAN SELECT id,
      json_extract(CAST(data AS TEXT), '$.run') FROM conversation_records
      WHERE kind = 'run' AND agent_id = ?
      AND json_extract(CAST(data AS TEXT), '$.run.initialInputId') = ?
      ORDER BY sequence, id LIMIT 1`)
      .all(selected.agentId, selected.initialInputId!);
    const details = plan.map((row) => String(row.detail)).join("\n");
    assert.match(details, /SEARCH.*conversation_records_initial_input_lookup/i);
    assert.doesNotMatch(details, /SCAN conversation_records|TEMP B-TREE/i);
    assert.deepEqual(
      database.prepare("SELECT * FROM conversation_records").all(),
      beforeRecords,
    );
    assert.deepEqual(
      database
        .prepare(
          "SELECT * FROM domain_documents WHERE namespace = 'agent_inputs' AND scope_id = 'global' AND document_id = 'agent_preserved'",
        )
        .all(),
      beforeDocuments,
    );
    const migrations = database
      .prepare("SELECT * FROM schema_migrations ORDER BY version")
      .all();
    assert.deepEqual(migrations.slice(0, 7), beforeLedger);
    assert.equal(migrations.length, 8);
    assert.equal(migrations[7]?.name, "run-initial-input-lookup-v8");
    const index = database
      .prepare("PRAGMA index_list(conversation_records)")
      .all()
      .find((row) => row.name === "conversation_records_initial_input_lookup");
    assert.equal(index?.unique, 0);
    assert.equal(index?.partial, 1);
    database.close();
  }
});
