import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runRecordSchema } from "@nervekit/contracts/runs";
import {
  findCanonicalRunByInitialInputId,
  readCanonicalRunState,
} from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-run-queries.js";
import {
  CanonicalStore,
  encode,
} from "../../../src/infrastructure/persistence/canonical-sqlite/index.js";
import {
  CANONICAL_MIGRATIONS,
  CANONICAL_SCHEMA_SQL,
} from "../../../src/infrastructure/persistence/canonical-sqlite/schema.js";

function metadata(
  runId: string,
  agentId = "agent_lookup",
  status = "completed",
) {
  return {
    runId,
    agentId,
    conversationId: `conv_${agentId}`,
    scopeId: `conv_${agentId}:${agentId}`,
    initialInputId: "input_lookup",
    revision: 1,
    status,
    stateEpoch: 1,
    projectId: "proj_lookup",
    recoverability: "none",
    executionId: "exec_lookup",
    attempt: 1,
    createdAt: "2026-10-08T00:00:00.000Z",
    updatedAt: "2026-10-08T00:00:00.000Z",
    cancellationEvidence: [],
  };
}

function insert(
  database: DatabaseSync,
  run: ReturnType<typeof metadata>,
  sequence: number,
) {
  database
    .prepare(`INSERT INTO conversation_records
    (id, conversation_id, agent_id, run_id, sequence, revision, kind, status,
     payload_version, data, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, 1, 'run', ?, 1, ?, 0, ?)`)
    .run(
      run.runId,
      run.conversationId,
      run.agentId,
      run.runId,
      sequence,
      run.status,
      encode({ run, state: { retained: "x".repeat(2 * 1024 * 1024) } }),
      100 - sequence,
    );
}

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(CANONICAL_SCHEMA_SQL);
  for (const migration of CANONICAL_MIGRATIONS) database.exec(migration.sql);
  return database;
}

test("initial-input lookup is indexed, bounded, owner-scoped and projection-independent", () => {
  const database = fixture();
  try {
    const first = metadata("run_first");
    insert(database, metadata("run_later", "agent_lookup", "running"), 2);
    insert(database, first, 1);
    insert(database, metadata("run_foreign", "agent_foreign"), 1);
    assert.equal(
      findCanonicalRunByInitialInputId(
        database,
        "agent_lookup",
        "input_absent",
      ),
      undefined,
    );
    assert.equal(
      findCanonicalRunByInitialInputId(
        database,
        "agent_absent",
        "input_lookup",
      ),
      undefined,
    );
    assert.deepEqual(
      findCanonicalRunByInitialInputId(
        database,
        "agent_lookup",
        "input_lookup",
      ),
      first,
    );
    assert.equal(
      database
        .prepare("SELECT count(*) AS n FROM conversation_record_projections")
        .get()?.n,
      0,
    );
    const plan = database
      .prepare(`EXPLAIN QUERY PLAN SELECT id,
      json_extract(CAST(data AS TEXT), '$.run') FROM conversation_records
      WHERE kind = 'run' AND agent_id = ?
      AND json_extract(CAST(data AS TEXT), '$.run.initialInputId') = ?
      ORDER BY sequence, id LIMIT 1`)
      .all("agent_lookup", "input_lookup");
    const details = plan.map((row) => String(row.detail)).join("\n");
    assert.match(details, /SEARCH.*conversation_records_initial_input_lookup/i);
    assert.doesNotMatch(details, /SCAN conversation_records|TEMP B-TREE/i);
    assert.deepEqual(
      findCanonicalRunByInitialInputId(
        database,
        "agent_foreign",
        "input_lookup",
      ),
      metadata("run_foreign", "agent_foreign"),
    );
  } finally {
    database.close();
  }
});

test("selected scalar/payload identity mismatch fails closed instead of selecting a later run", () => {
  const database = fixture();
  try {
    insert(database, metadata("run_first"), 1);
    insert(database, metadata("run_later"), 2);
    for (const [field, value] of [
      ["runId", "run_wrong"],
      ["agentId", "agent_wrong"],
      ["conversationId", "conv_wrong"],
      ["scopeId", "foreign"],
      ["revision", 2],
      ["status", "running"],
    ] as const) {
      database
        .prepare(
          "UPDATE conversation_records SET data = ? WHERE id = 'run_first'",
        )
        .run(encode({ run: { ...metadata("run_first"), [field]: value } }));
      assert.throws(
        () =>
          findCanonicalRunByInitialInputId(
            database,
            "agent_lookup",
            "input_lookup",
          ),
        /identity mismatch/,
      );
    }
    database
      .prepare(
        "UPDATE conversation_records SET data = ? WHERE id = 'run_first'",
      )
      .run(
        encode({
          run: { ...metadata("run_first"), executionId: "not-an-execution" },
        }),
      );
    assert.throws(() =>
      findCanonicalRunByInitialInputId(
        database,
        "agent_lookup",
        "input_lookup",
      ),
    );
  } finally {
    database.close();
  }
});

test("real read worker returns only selected metadata, including settled runs after reopen", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-run-input-lookup-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const path = join(home, "nerve.sqlite");
  const first = new CanonicalStore(path);
  await first.initialize();
  await first.close();
  const database = new DatabaseSync(path);
  insert(database, metadata("run_terminal"), 1);
  insert(database, metadata("run_unrelated", "agent_other"), 1);
  database.close();
  const reopened = new CanonicalStore(path);
  t.after(() => reopened.close());
  await reopened.initialize();
  assert.deepEqual(
    await reopened.findRunByInitialInputId("agent_lookup", "input_lookup"),
    metadata("run_terminal"),
  );
  assert.equal(
    await reopened.findRunByInitialInputId("agent_lookup", "input_missing"),
    undefined,
  );
});

test("legacy runs without an originating input stay readable and do not match", () => {
  const database = fixture();
  try {
    const legacy = runRecordSchema.parse(metadata("run_legacy"));
    delete legacy.initialInputId;
    database
      .prepare(`INSERT INTO conversation_records
      (id, conversation_id, agent_id, run_id, sequence, revision, kind, status,
       payload_version, data, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, 1, 1, 'run', 'completed', 1, ?, 0, 0)`)
      .run(
        legacy.runId,
        legacy.conversationId,
        legacy.agentId,
        legacy.runId,
        encode({
          run: legacy,
          state: {
            run: legacy,
            prompts: [],
            transitions: [],
            interactions: [],
            checkpoints: [],
            deliveries: [],
          },
        }),
      );
    assert.deepEqual(readCanonicalRunState(database, legacy.runId), {
      run: legacy,
      prompts: [],
      transitions: [],
      interactions: [],
      checkpoints: [],
      deliveries: [],
    });
    assert.equal(
      findCanonicalRunByInitialInputId(
        database,
        legacy.agentId,
        "input_lookup",
      ),
      undefined,
    );
  } finally {
    database.close();
  }
});

test("record ID deterministically breaks a sequence tie", () => {
  const database = fixture();
  try {
    // Conversation-local sequences cannot tie within one conversation. Use two
    // source-consistent conversations to exercise the index's final ordering key.
    const laterId = metadata("run_z");
    const firstId = {
      ...metadata("run_a"),
      conversationId: "conv_another",
      scopeId: "conv_another:agent_lookup",
    };
    insert(database, laterId, 1);
    insert(database, firstId, 1);
    assert.deepEqual(
      findCanonicalRunByInitialInputId(
        database,
        "agent_lookup",
        "input_lookup",
      ),
      firstId,
    );
  } finally {
    database.close();
  }
});
