import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import step from "./step.js";
import { CANONICAL_MIGRATIONS } from "../../../persistence/canonical-sqlite/schema.js";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE conversation_records(id TEXT PRIMARY KEY, agent_id TEXT, sequence INTEGER, kind TEXT, data BLOB)",
  );
  return db;
}

void test("v8 managed step builds the same authoritative nonunique index and preserves duplicate and legacy bytes", async () => {
  const db = fixture();
  try {
    const insert = db.prepare(
      "INSERT INTO conversation_records VALUES (?, 'agent_test', ?, 'run', ?)",
    );
    insert.run(
      "run_later",
      2,
      Buffer.from(
        JSON.stringify({
          run: { initialInputId: "input_test" },
          state: { unknown: "retained" },
        }),
      ),
    );
    insert.run(
      "run_first",
      1,
      Buffer.from(JSON.stringify({ run: { initialInputId: "input_test" } })),
    );
    insert.run(
      "run_legacy",
      3,
      Buffer.from(JSON.stringify({ run: {}, unknown: true })),
    );
    const before = db
      .prepare("SELECT * FROM conversation_records ORDER BY id")
      .all();
    await step.run({ db } as never);
    await step.verify?.({ db } as never);
    assert.deepEqual(
      db.prepare("SELECT * FROM conversation_records ORDER BY id").all(),
      before,
    );
    assert.equal(
      db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE name = 'conversation_records_initial_input_lookup'",
        )
        .get()?.sql,
      CANONICAL_MIGRATIONS.find(
        (migration) => migration.version === 8,
      )!.sql.slice(0, -1),
    );
    assert.equal(
      db
        .prepare(`SELECT id FROM conversation_records WHERE kind = 'run' AND agent_id = ?
      AND json_extract(CAST(data AS TEXT), '$.run.initialInputId') = ? ORDER BY sequence, id LIMIT 1`)
        .get("agent_test", "input_test")?.id,
      "run_first",
    );
  } finally {
    db.close();
  }
});

void test("malformed authoritative JSON aborts index creation without altering records", async () => {
  const db = fixture();
  try {
    db.prepare(
      "INSERT INTO conversation_records VALUES ('run_invalid', 'agent_test', 1, 'run', ?)",
    ).run(Buffer.from("invalid-json"));
    const before = db.prepare("SELECT * FROM conversation_records").all();
    await assert.rejects(
      async () => step.run({ db } as never),
      /malformed JSON/,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM conversation_records").all(),
      before,
    );
    assert.equal(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name = 'conversation_records_initial_input_lookup'",
        )
        .get(),
      undefined,
    );
  } finally {
    db.close();
  }
});
