import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import step from "./step.js";
import { legacyTaskV1 } from "./shapes.js";

void test("parses only the frozen task fields and tolerates unknown fields", () => {
  const value = legacyTaskV1({
    id: "task_1",
    status: "completed",
    startedAt: "2024-01-01T00:00:00.000Z",
    future: true,
  });
  assert.equal(value.restartGeneration, 0);
  assert.equal(value.status, "completed");
  assert.throws(
    () =>
      legacyTaskV1({
        id: "task_2",
        status: "completed",
        startedAt: "not-a-date",
      }),
    /valid timestamp/,
  );
  assert.throws(
    () =>
      legacyTaskV1({
        id: "task_3",
        status: "completed",
        startedAt: "2024-01-01T00:00:00Z",
        completion: { inject: true, entryId: 3 },
      }),
    /must be a string/,
  );
});

void test("skips hostile derived completion rows and records the backfill", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE subagent_completions (run_id TEXT PRIMARY KEY, data BLOB);
  CREATE TABLE agent_async_obligations (
    id TEXT PRIMARY KEY, conversation_id TEXT, owner_agent_id TEXT,
    source_kind TEXT, source_id TEXT, source_agent_id TEXT, state TEXT,
    notification_entry_id TEXT, generation INTEGER, payload_version INTEGER,
    data BLOB, created_at_ms INTEGER, updated_at_ms INTEGER,
    UNIQUE(source_kind, source_id, generation)
  );
  CREATE TABLE domain_documents (
    namespace TEXT, scope_id TEXT, document_id TEXT, revision INTEGER,
    payload_version INTEGER, data BLOB, created_at_ms INTEGER, updated_at_ms INTEGER,
    PRIMARY KEY(namespace, scope_id, document_id)
  );`);
  db.prepare("INSERT INTO subagent_completions VALUES (?, ?)").run(
    "run_bad_json",
    new TextEncoder().encode("{"),
  );
  db.prepare("INSERT INTO subagent_completions VALUES (?, ?)").run(
    "run_bad_date",
    new TextEncoder().encode(
      JSON.stringify({
        runId: "run_bad_date",
        childId: "child",
        leadId: "lead",
        conversationId: "conv",
        entryId: "entry",
        generation: 0,
        createdAt: "bad",
        suppressed: false,
      }),
    ),
  );
  db.prepare("INSERT INTO subagent_completions VALUES (?, ?)").run(
    "run_good",
    new TextEncoder().encode(
      JSON.stringify({
        runId: "run_good",
        childId: "child",
        leadId: "lead",
        conversationId: "conv",
        entryId: "entry",
        generation: 0,
        createdAt: "2024-01-01T00:00:00.000Z",
        suppressed: false,
      }),
    ),
  );
  const rows = { async eachDocument() {} };
  await step.run({ db, rows, nowMs: 1 } as never);
  assert.deepEqual(
    db
      .prepare("SELECT id FROM agent_async_obligations ORDER BY id")
      .all()
      .map((row) => row.id),
    ["async_subagent:run_good:0"],
  );
  assert.ok(
    db
      .prepare(
        "SELECT 1 FROM domain_documents WHERE namespace = 'canonical_data_migration'",
      )
      .get(),
  );
  db.close();
});
