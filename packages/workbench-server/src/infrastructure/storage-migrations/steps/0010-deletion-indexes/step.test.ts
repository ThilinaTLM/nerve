import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import step from "./step.js";

void test("0010-deletion-indexes", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE durable_events(record_id TEXT); CREATE TABLE agent_context_leaves(active_record_id TEXT);",
  );
  await step.run({ db } as never);
  await step.verify?.({ db } as never);
  assert.deepEqual(
    (
      db.prepare("PRAGMA index_info('durable_events_record')").all() as Array<{
        name: string;
      }>
    ).map((x) => x.name),
    ["record_id"],
  );
  db.close();
});
