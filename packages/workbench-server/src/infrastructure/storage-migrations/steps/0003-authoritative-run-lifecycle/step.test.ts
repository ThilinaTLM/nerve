import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import step from "./step.js";

void test("0003-authoritative-run-lifecycle", async () => {
  const db = new DatabaseSync(":memory:");
  await step.run({ db } as never);
  assert.ok(
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='run_lifecycle_records'",
      )
      .get(),
  );
  db.close();
});
