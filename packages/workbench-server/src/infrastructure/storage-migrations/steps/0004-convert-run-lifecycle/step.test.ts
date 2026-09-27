import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import step from "./step.js";

void test("0004-convert-run-lifecycle", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE conversation_records (id TEXT, conversation_id TEXT, status TEXT, revision INTEGER, payload_version INTEGER, data BLOB, updated_at_ms INTEGER, kind TEXT); CREATE TABLE run_lifecycle_records (run_id TEXT PRIMARY KEY, conversation_id TEXT, lifecycle_state TEXT, branch_epoch INTEGER, revision INTEGER, payload_version INTEGER, data BLOB, updated_at_ms INTEGER);",
  );
  db.prepare(
    "INSERT INTO conversation_records VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run("run_1", "conv_1", "completed", 2, 1, new Uint8Array(), 1, "run");
  await step.run({ db } as never);
  assert.equal(
    (
      db.prepare("SELECT lifecycle_state FROM run_lifecycle_records").get() as {
        lifecycle_state: string;
      }
    ).lifecycle_state,
    "completed",
  );
  db.close();
});
