import assert from "node:assert/strict";
import { test } from "node:test";
import { openCoreDatabase } from "./database.js";
import { ConversationEventRepository } from "./conversation-event.repository.js";

test("usage aggregates all retained branches and recursive agents without double counting", () => {
  const db = openCoreDatabase(":memory:");
  try {
    // Narrow fixtures exercise the persisted query without transcript decoding.
    db.sqlite
      .exec(`CREATE TABLE conversation (id TEXT PRIMARY KEY, parent_conversation_id TEXT);
      CREATE TABLE conversation_event (id TEXT PRIMARY KEY, conversation_id TEXT, event_type TEXT, payload TEXT);
      INSERT INTO conversation VALUES ('lead', NULL), ('child', 'lead'), ('nested', 'child'),
        ('empty', 'lead'), ('unrelated', NULL);`);
    const repo = new ConversationEventRepository(db);
    assert.throws(() => repo.getUsage("missing"), /Conversation not found/);
    assert.equal(repo.getUsage("lead").subagentCount, 3);
    assert.equal(repo.getUsage("lead").total.totalTokens, 0);
    const insert = db.sqlite.prepare(
      "INSERT INTO conversation_event VALUES (?, ?, ?, ?)",
    );
    const payload = JSON.stringify({
      usage: {
        input: 10,
        output: 5,
        cacheRead: 3,
        cacheWrite: 2,
        cacheWrite1h: 2,
        reasoning: 4,
        totalTokens: 999,
        cost: { total: 0.25 },
      },
    });
    for (const [id, agent] of [
      ["old-branch", "lead"],
      ["new-branch", "lead"],
      ["completed", "child"],
      ["failed", "nested"],
      ["other", "unrelated"],
    ])
      insert.run(id, agent, "assistant_message", payload);
    insert.run("non-response", "lead", "compaction", payload);
    const usage = repo.getUsage("lead");
    assert.deepEqual(usage.own, {
      responseCount: 2,
      input: 20,
      output: 10,
      cacheRead: 6,
      cacheWrite: 4,
      totalTokens: 40,
      cost: 0.5,
    });
    assert.deepEqual(usage.subagents, usage.own);
    assert.equal(usage.total.totalTokens, 80);
    assert.equal(usage.total.responseCount, 4);
    assert.equal(usage.total.cost, 1);
    assert.equal(repo.getUsage("child").subagentCount, 1);
    assert.equal(repo.getUsage("child").total.totalTokens, 40);
    db.sqlite.exec(
      "DELETE FROM conversation_event WHERE conversation_id = 'nested'; DELETE FROM conversation WHERE id = 'nested'",
    );
    assert.equal(repo.getUsage("lead").subagentCount, 2);
    assert.equal(repo.getUsage("lead").total.totalTokens, 60);
    assert.equal(repo.getUsage("empty").total.responseCount, 0);
  } finally {
    db.close();
  }
});
