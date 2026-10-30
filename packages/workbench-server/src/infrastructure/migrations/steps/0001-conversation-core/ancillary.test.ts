import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runMigrations } from "../../framework/runner.js";
import { fixture, registry } from "./step-fixture.js";

for (const namespace of [
  "agent",
  "task",
  "agent_inputs",
  "agent_input_preparation",
]) {
  void test(`unreadable ${namespace} uses a recoverable owner or a single configuration fallback`, async (t) => {
    const home = await fixture(t);
    const db = new DatabaseSync(join(home, "data/nerve.sqlite"));
    try {
      if (namespace === "agent" || namespace === "task") {
        db.prepare(
          "UPDATE domain_documents SET data = ? WHERE namespace = ? AND document_id = ?",
        ).run(
          Buffer.from("{broken"),
          namespace,
          namespace === "agent" ? "agent_one" : "task_old",
        );
      } else {
        db.prepare(
          "INSERT INTO domain_documents VALUES ('agent_inputs', 'global', 'agent_one', ?)",
        ).run(
          Buffer.from(
            namespace === "agent_inputs"
              ? "{broken"
              : JSON.stringify({
                  inputs: [
                    {
                      id: "input_one",
                      conversationId: "conv_one",
                      sequence: 1,
                    },
                  ],
                }),
          ),
        );
        if (namespace === "agent_input_preparation")
          db.prepare(
            "INSERT INTO domain_documents VALUES ('agent_input_preparation', 'global', 'input_one', ?)",
          ).run(Buffer.from("{broken"));
      }
    } finally {
      db.close();
    }
    await runMigrations(home, { registry });
    const expected =
      namespace === "task" ? "legacy-record:task/task_old" : "conv_one";
    const report = JSON.parse(
      await readFile(
        join(home, "migrations/reports/0001-conversation-core.json"),
        "utf8",
      ),
    );
    const item = report.setAside.find(
      (entry: { id: string }) => entry.id === expected,
    );
    const raw = await readFile(
      join(item.quarantinePath, "payload/records.jsonl"),
      "utf8",
    );
    assert(raw.includes(namespace));
    assert(!raw.includes('"document_id":"conv_two"'));
  });
}

void test("setting aside an unreadable project also quarantines its reported dependent conversations", async (t) => {
  const home = await fixture(t);
  const db = new DatabaseSync(join(home, "data/nerve.sqlite"));
  try {
    db.prepare(
      "UPDATE domain_documents SET data = ? WHERE namespace = 'project'",
    ).run(Buffer.from("{broken"));
  } finally {
    db.close();
  }
  await runMigrations(home, { registry });
  const report = JSON.parse(
    await readFile(
      join(home, "migrations/reports/0001-conversation-core.json"),
      "utf8",
    ),
  );
  for (const id of [
    "legacy-record:project/proj_fixture",
    "conv_one",
    "conv_two",
  ]) {
    const item = report.setAside.find((item: { id: string }) => item.id === id);
    assert(item);
    assert(
      (
        await readFile(
          join(item.quarantinePath, "payload/records.jsonl"),
          "utf8",
        )
      ).length,
    );
  }
});
