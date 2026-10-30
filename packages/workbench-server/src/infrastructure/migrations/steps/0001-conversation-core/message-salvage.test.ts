import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { runMigrations } from "../../framework/runner.js";
import { rollbackFailedMigration } from "../../framework/recovery.js";
import type { Legacy } from "./legacy.reader.js";
import { fixture, registry, timestamp } from "./step-fixture.js";

const conversationId = "conv_salvage";
const agentId = "agent_salvage";
const lost = new Map([
  ["lost_user", Buffer.from('{"entry": invalid user bytes\u0000')],
  ["lost_assistant", Buffer.from('{"entry": invalid assistant bytes\ufffd')],
]);
const ids = ["before", "lost_user", "middle", "lost_assistant", "after"];
function message(
  id: string,
  parentId: string | null,
  role: "user" | "assistant",
  text: string,
): Legacy {
  return {
    entry: { id, kind: "message", text, createdAt: timestamp },
    modelContext: {
      visibility: "model_and_history",
      entry: {
        id,
        type: "message",
        parentId,
        message:
          role === "user"
            ? { role, content: text }
            : {
                role,
                content: [{ type: "text", text }],
                api: "fixture",
                provider: "fixture",
                model: "model",
                stopReason: "stop",
                timestamp: 0,
                usage: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 0,
                  cost: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    total: 0,
                  },
                },
              },
      },
    },
  };
}
async function homeWithDamage(t: TestContext): Promise<string> {
  const home = await fixture(t);
  const db = new DatabaseSync(join(home, "data/nerve.sqlite"));
  try {
    db.prepare(
      "INSERT INTO domain_documents VALUES ('conversation', 'global', ?, ?)",
    ).run(
      conversationId,
      Buffer.from(
        JSON.stringify({
          id: conversationId,
          projectId: "proj_fixture",
          activeAgentId: agentId,
          title: "Retained damaged history",
          createdAt: timestamp,
        }),
      ),
    );
    db.prepare(
      "INSERT INTO domain_documents VALUES ('agent', 'global', ?, ?)",
    ).run(
      agentId,
      Buffer.from(
        JSON.stringify({
          id: agentId,
          conversationId,
          model: { provider: "fixture", modelId: "model" },
          createdAt: timestamp,
        }),
      ),
    );
    for (const [index, id] of ids.entries())
      db.prepare(
        "INSERT INTO conversation_records VALUES (?, ?, ?, 'message', ?, ?, NULL, 0, ?)",
      ).run(
        id,
        conversationId,
        agentId,
        index + 1,
        index ? ids[index - 1] : null,
        lost.get(id) ??
          Buffer.from(
            JSON.stringify(
              message(
                id,
                index ? ids[index - 1] : null,
                id === "middle" ? "assistant" : "user",
                `${id} readable text`,
              ),
            ),
          ),
      );
    db.prepare(
      "INSERT INTO agent_context_leaves VALUES (?, 'agent_conversation', ?)",
    ).run(conversationId, "after");
  } finally {
    db.close();
  }
  return home;
}
async function events(home: string) {
  const db = new DatabaseSync(join(home, "data/nerve.sqlite"), {
    readOnly: true,
  });
  try {
    return db
      .prepare(
        "SELECT id, event_type, llm_representation, previous_event_id, payload FROM conversation_event WHERE conversation_id = ? ORDER BY sequence",
      )
      .all(conversationId);
  } finally {
    db.close();
  }
}
async function assertQuarantine(home: string): Promise<void> {
  const root = join(home, "quarantine/0001-conversation-core");
  let checked = 0;
  for (const name of await readdir(root)) {
    const entry = join(root, name);
    const reason = JSON.parse(
      await readFile(join(entry, "reason.json"), "utf8"),
    );
    const id = reason.id.split("/record/")[1];
    if (!lost.has(id)) continue;
    assert.equal(reason.kind, "conversation");
    assert(reason.reason.includes(id));
    const rows = (await readFile(join(entry, "payload/records.jsonl"), "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].table, "conversation_records");
    assert.equal(rows[0].row.id, id);
    assert.equal(rows[0].row.conversation_id, conversationId);
    assert.deepEqual(
      Buffer.from(rows[0].row.data.$blob, "base64"),
      lost.get(id),
    );
    checked++;
  }
  assert.equal(checked, 2);
}
void test("retains surviving user/assistant history with explicit unknown-message placeholders and durable raw-record losses", async (t) => {
  const home = await homeWithDamage(t);
  let imports = 0;
  await runMigrations(home, {
    registry,
    onProgress: ({ phase, done }) => {
      if (phase === "import" && done === 0) imports++;
    },
  });
  assert.equal(imports, 1);
  const rows = await events(home);
  assert.deepEqual(
    rows.map((row) => row.event_type),
    [
      "user_message",
      "system_event",
      "assistant_message",
      "system_event",
      "user_message",
    ],
  );
  for (let index = 0; index < rows.length; index++)
    assert.equal(
      rows[index].previous_event_id,
      index ? rows[index - 1].id : null,
    );
  const payloads = rows.map((row) => JSON.parse(String(row.payload)));
  assert.equal(payloads[0].text, "before readable text");
  assert.equal(payloads[2].content[0].text, "middle readable text");
  assert.equal(payloads[4].text, "after readable text");
  for (const index of [1, 3]) {
    assert.equal(rows[index].llm_representation, "none");
    assert.equal(payloads[index].subtype, "notification");
    assert.equal(payloads[index].producer, "import:migration_loss");
    assert.match(payloads[index].text, /speaker and content are unknown/);
    assert(payloads[index].text.includes(ids[index]));
  }
  await assertQuarantine(home);
  const report = JSON.parse(
    await readFile(
      join(home, "migrations/reports/0001-conversation-core.json"),
      "utf8",
    ),
  );
  assert.deepEqual(report.setAside, []);
  assert.equal(
    report.losses.find((loss: { reason: string }) =>
      loss.reason.includes("Unreadable message record"),
    ).count,
    2,
  );
  assert(!existsSync(join(home, "data/nerve.sqlite.migrating")));
});
void test("salvage receipts and raw archives survive import reuse after an unrelated failed unit is set aside", async (t) => {
  const home = await homeWithDamage(t);
  const db = new DatabaseSync(join(home, "data/nerve.sqlite"));
  try {
    db.prepare(
      "INSERT INTO domain_documents VALUES ('conversation', 'global', 'conv_broken', ?)",
    ).run(Buffer.from("{broken"));
  } finally {
    db.close();
  }
  await runMigrations(home, { registry });
  const before = await events(home);
  await assertQuarantine(home);
  const phases: string[] = [];
  await runMigrations(home, {
    registry,
    onProgress: ({ phase }) => phases.push(phase),
  });
  assert(!phases.includes("import"));
  assert.deepEqual(await events(home), before);
  await assertQuarantine(home);
  const report = JSON.parse(
    await readFile(
      join(home, "migrations/reports/0001-conversation-core.json"),
      "utf8",
    ),
  );
  assert.deepEqual(
    report.setAside.map((item: { id: string }) => item.id),
    ["conv_broken"],
  );
  assert.equal(
    report.losses.find((loss: { reason: string }) =>
      loss.reason.includes("Unreadable message record"),
    ).count,
    2,
  );
});
void test("rollback restores exact legacy database and configuration bytes after successful record salvage", async (t) => {
  const home = await homeWithDamage(t);
  const watched = [
    "manifest.json",
    "data/nerve.sqlite",
    "config/harness.json",
    "config/settings.json",
  ];
  const original = await Promise.all(
    watched.map((path) => readFile(join(home, path))),
  );
  await assert.rejects(
    runMigrations(home, {
      registry,
      onProgress: ({ phase }) => {
        if (phase === "verify") throw new Error("stop before verification");
      },
    }),
    /stop before verification/,
  );
  await assertQuarantine(home);
  await rollbackFailedMigration(home, { registry });
  for (const [index, path] of watched.entries())
    assert.deepEqual(await readFile(join(home, path)), original[index], path);
  assert(!existsSync(join(home, "quarantine")));
  assert(
    !existsSync(join(home, "migrations/reports/0001-conversation-core.json")),
  );
});
for (const mode of [
  "root",
  "semantic-shape",
  "timestamp",
  "ordering",
  "selected-head",
  "tool-kind",
  "policy-kind",
  "parent-disagreement",
  "tool-neighbor",
  "missing-owner",
]) {
  void test(`does not salvage ${mode} ambiguity or policy/tool semantics`, async (t) => {
    const home = await homeWithDamage(t);
    const db = new DatabaseSync(join(home, "data/nerve.sqlite"));
    try {
      if (mode === "root")
        db.prepare(
          "UPDATE conversation_records SET data = ? WHERE id = 'before'",
        ).run(Buffer.from("{broken root"));
      if (mode === "semantic-shape")
        db.prepare(
          "UPDATE conversation_records SET data = ? WHERE id = 'lost_user'",
        ).run(Buffer.from("null"));
      if (mode === "timestamp")
        db.exec(
          "UPDATE conversation_records SET created_at_ms = NULL WHERE id = 'lost_user'",
        );
      if (mode === "ordering")
        db.exec(
          "UPDATE conversation_records SET sequence = 1 WHERE id = 'lost_user'",
        );
      if (mode === "selected-head")
        db.exec(
          "UPDATE agent_context_leaves SET active_record_id = 'middle' WHERE conversation_id = 'conv_salvage'",
        );
      if (mode === "tool-kind")
        db.exec(
          "UPDATE conversation_records SET kind = 'tool_call' WHERE id = 'lost_user'",
        );
      if (mode === "policy-kind")
        db.exec(
          "UPDATE conversation_records SET kind = 'permission' WHERE id = 'lost_user'",
        );
      if (mode === "parent-disagreement") {
        const data = message("middle", "before", "assistant", "text");
        db.prepare(
          "UPDATE conversation_records SET data = ? WHERE id = 'middle'",
        ).run(Buffer.from(JSON.stringify(data)));
      }
      if (mode === "tool-neighbor") {
        const data = message("middle", "lost_user", "assistant", "text");
        data.modelContext.entry.message.content = [
          { type: "toolCall", id: "unknown", name: "bash", arguments: {} },
        ];
        db.prepare(
          "UPDATE conversation_records SET data = ? WHERE id = 'middle'",
        ).run(Buffer.from(JSON.stringify(data)));
      }
      if (mode === "missing-owner")
        db.exec(
          "DELETE FROM domain_documents WHERE namespace = 'agent' AND document_id = 'agent_salvage'",
        );
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
    assert(
      report.setAside.some(
        (item: { id: string }) => item.id === conversationId,
      ),
    );
    assert.deepEqual(await events(home), []);
    const item = report.setAside.find(
      (item: { id: string }) => item.id === conversationId,
    );
    assert(
      (
        await readFile(
          join(item.quarantinePath, "payload/records.jsonl"),
          "utf8",
        )
      ).includes(conversationId),
    );
  });
}

void test("failed raw-record preservation prevents cleanup and never commits a guessed replacement", async (t) => {
  const home = await homeWithDamage(t);
  const originalStep = registry[0].step;
  const guarded = [
    {
      ...registry[0],
      step: {
        ...originalStep,
        async run(ctx: Parameters<typeof originalStep.run>[0]) {
          const quarantine = ctx.quarantine;
          ctx.quarantine = (item, payload) => {
            if (item.id.includes("/record/"))
              throw new Error("Raw archive unavailable");
            return quarantine(item, payload);
          };
          try {
            await originalStep.run(ctx);
          } finally {
            ctx.quarantine = quarantine;
          }
        },
      },
    },
  ];
  await runMigrations(home, { registry: guarded });
  assert.deepEqual(await events(home), []);
  const report = JSON.parse(
    await readFile(
      join(home, "migrations/reports/0001-conversation-core.json"),
      "utf8",
    ),
  );
  const item = report.setAside.find(
    (item: { id: string }) => item.id === conversationId,
  );
  assert.ok(item);
  assert.match(item.reason, /Raw archive unavailable/);
  const rows = (
    await readFile(join(item.quarantinePath, "payload/records.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  for (const [id, bytes] of lost) {
    const row = rows.find(
      (entry) => entry.table === "conversation_records" && entry.row.id === id,
    );
    assert.deepEqual(Buffer.from(row.row.data.$blob, "base64"), bytes);
  }
});

void test("verification attributes altered placeholder text to the owning conversation", async (t) => {
  const home = await homeWithDamage(t);
  await runMigrations(home, {
    registry,
    onProgress: ({ phase }) => {
      if (phase !== "verify") return;
      const db = new DatabaseSync(join(home, "data/nerve.sqlite"));
      try {
        db.prepare(
          "UPDATE conversation_event SET payload = json_set(payload, '$.text', 'silenced') WHERE conversation_id = ? AND event_type = 'system_event'",
        ).run(conversationId);
      } finally {
        db.close();
      }
    },
  });
  const report = JSON.parse(
    await readFile(
      join(home, "migrations/reports/0001-conversation-core.json"),
      "utf8",
    ),
  );
  const item = report.setAside.find(
    (item: { id: string }) => item.id === conversationId,
  );
  assert.ok(item);
  assert.match(item.reason, /Changed history-loss placeholder/);
  assert.deepEqual(await events(home), []);
});
