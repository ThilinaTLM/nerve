import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { CanonicalDatabase } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-database.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";
import type { ConversationDeletionCursor } from "../../../src/infrastructure/persistence/canonical-sqlite/conversation-deletion.js";

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const home = await mkdtemp(join(tmpdir(), "nerve-bounded-deletion-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const path = join(home, "nerve.sqlite");
  const canonical = new CanonicalDatabase(path);
  canonical.initialize();
  canonical.close();
  const database = new DatabaseSync(path);
  database.exec("PRAGMA foreign_keys = ON; BEGIN");
  const record = database.prepare(`INSERT INTO conversation_records
    (id, conversation_id, agent_id, parent_id, sequence, revision, kind, status, payload_version, data, created_at_ms, updated_at_ms)
    VALUES (?, ?, 'agent', ?, ?, 1, 'message', 'completed', 1, ?, 0, 0)`);
  const event = database.prepare(`INSERT INTO durable_events
    (stream, stream_sequence, conversation_id, record_id, intent_id, event_type, payload_version, data, occurred_at_ms)
    VALUES (?, ?, ?, ?, ?, 'test', 1, ?, 0)`);
  const leaf = database.prepare(
    "INSERT INTO agent_context_leaves VALUES (?, ?, ?, 1)",
  );
  const data = Buffer.from("not a decoded history payload");
  for (const [conversation, count] of [
    ["target", 2500],
    ["unrelated", 10000],
  ] as const) {
    for (let n = 1; n <= count; n++) {
      const id = `${conversation}-${n}`;
      record.run(
        id,
        conversation,
        n === 1 ? null : `${conversation}-${n - 1}`,
        n,
        data,
      );
      event.run(conversation, n, conversation, id, id, data);
      if (n <= 1000) leaf.run(conversation, `agent-${n}`, id);
    }
  }
  database.exec("COMMIT");
  database.close();
  return path;
}

function assertRemaining(path: string) {
  const database = new DatabaseSync(path);
  assert.equal(
    database
      .prepare(
        "SELECT count(*) AS count FROM conversation_records WHERE conversation_id = 'target'",
      )
      .get()?.count,
    0,
  );
  assert.equal(
    database
      .prepare(
        "SELECT count(*) AS count FROM conversation_records WHERE conversation_id = 'unrelated'",
      )
      .get()?.count,
    10000,
  );
  assert.equal(
    database.prepare("SELECT count(*) AS count FROM durable_events").get()
      ?.count,
    10000,
  );
  assert.equal(
    database.prepare("SELECT count(*) AS count FROM agent_context_leaves").get()
      ?.count,
    1000,
  );
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  database.close();
}

test("production deletion commands bound rows and distinguish keyset detachment", async (t) => {
  const path = await fixture(t);
  const database = new CanonicalDatabase(path);
  let cursor: ConversationDeletionCursor = { phase: "events" };
  let removed = 0;
  let detached = 0;
  let commands = 0;
  for (;;) {
    const result = database.deleteConversationStateChunk(
      "target",
      1000,
      cursor,
    );
    assert.ok(result.removed <= 500);
    assert.ok(result.detached <= 500);
    if (result.phase === "parent_links") {
      assert.equal(result.removed, 0);
      if (result.next.phase === "parent_links")
        assert.ok(
          (result.next.afterSequence ?? 0) > (cursor.afterSequence ?? 0),
        );
    }
    cursor = result.next;
    removed += result.removed;
    detached += result.detached;
    assert.ok(++commands < 100, "phases must make bounded forward progress");
    if (result.done) break;
  }
  assert.equal(removed, 6000);
  assert.equal(detached, 2499);
  database.close();
  assertRemaining(path);
});

test("worker-backed deletion interleaves unrelated reads and writes before completion", async (t) => {
  const path = await fixture(t);
  const store = new CanonicalStore(path);
  await store.initialize();
  let interleaved = false;
  let completed = false;
  let previousRemoved = 0;
  await store.deleteConversationState("target", async (progress) => {
    assert.ok(progress.removed >= previousRemoved);
    previousRemoved = progress.removed;
    if (!interleaved && progress.removed > 0) {
      assert.equal(completed, false);
      await store.writeDocument({
        namespace: "test",
        scopeId: "global",
        documentId: "unrelated",
        data: { ok: true },
        expectedRevision: 0,
      });
      assert.deepEqual(
        (await store.readDocument("test", "global", "unrelated"))?.data,
        { ok: true },
      );
      interleaved = true;
    }
  });
  completed = true;
  assert.equal(interleaved, true);
  assert.equal(previousRemoved, 6000);
  await store.close();
  assertRemaining(path);
});

test("committed deletion intent blocks partial hydration and recovers only its conversation", async (t) => {
  const { ConversationJournalRepository } =
    await import("../../../src/domains/conversations/conversation-journal.repository.js");
  const path = await fixture(t);
  const first = new ConversationJournalRepository({
    paths: { home: path, sqlitePath: path },
  });
  await assert.rejects(
    first.remove("target", {
      operationId: "maintenance-test",
      onProgress: (progress) => {
        if (progress.removed > 0)
          throw new Error("simulated process interruption after commit");
      },
    }),
    /simulated process interruption/,
  );
  await assert.rejects(first.load("target"), /being deleted/);
  await first.close();
  const reopened = new ConversationJournalRepository({
    paths: { home: path, sqlitePath: path },
  });
  await assert.rejects(reopened.load("target"), /being deleted/);
  await assert.rejects(
    reopened.deletions.recover(async (intent) => {
      assert.equal(intent.operationId, "maintenance-test");
      throw new Error("residual payload cleanup failed");
    }),
    /residual payload cleanup failed/,
  );
  await assert.rejects(reopened.load("target"), /being deleted/);
  let finalized = false;
  await reopened.deletions.recover(async (intent) => {
    assert.equal(intent.conversationId, "target");
    finalized = true;
  });
  assert.equal(finalized, true);
  assert.equal((await reopened.load("target")).revision, 0);
  await reopened.close();
  assertRemaining(path);
  const database = new DatabaseSync(path);
  assert.equal(
    database
      .prepare(
        "SELECT count(*) AS count FROM domain_documents WHERE namespace = 'conversation_deletion'",
      )
      .get()?.count,
    0,
  );
  database.close();
});
