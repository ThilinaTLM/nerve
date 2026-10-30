import assert from "node:assert/strict";
import test from "node:test";
import { CoreStorage } from "./core-storage.js";
import { openCoreDatabase } from "./database.js";
import { migrate } from "./migrations.js";
import type { ConversationReadFailure } from "./conversation.repository.js";
import { recoverCore } from "../runtime/recovery.js";
import { publishSummary } from "../runtime/publish-summary.js";
import { StatusService } from "../runtime/status.js";

const at = "2026-10-30T00:00:00.000Z";
function fixture() {
  const db = openCoreDatabase(":memory:");
  migrate(db);
  const failures: ConversationReadFailure[] = [];
  const storage = new CoreStorage(db, (failure) => failures.push(failure));
  storage.projects.insert({
    id: "p",
    name: "P",
    directory: "/tmp",
    createdAt: at,
    updatedAt: at,
  });
  const insert = (id: string, parentConversationId: string | null = null) =>
    storage.conversations.insert(
      {
        id,
        projectId: "p",
        parentConversationId,
        parentToolCallId: null,
        headEventId: null,
        title: id,
        status: "idle",
        statusEventSequence: 0,
        statusClearedAt: null,
        paused: false,
        nextInputSequence: 1,
        pinnedAt: null,
        completedAt: null,
        lastUserMessageAt: null,
        createdAt: at,
        updatedAt: at,
      },
      {
        conversationId: id,
        model: { provider: "test", modelId: "test" },
        reasoningLevel: "off",
        systemPrompt: null,
        instructions: null,
        permissionRuleSetId: "baseline",
        agentProfile: "coding",
        workingDirectory: "/tmp",
      },
    );
  const event = (id: string) =>
    storage.events.append({
      id: `event-${id}`,
      conversationId: id,
      turnId: null,
      inputId: null,
      createdAt: at,
      type: "user_message",
      llmRepresentation: "user",
      payload: {
        text: "hello",
        originalText: "hello",
        source: "user",
        senderConversationId: null,
        commandPreparation: null,
      },
    });
  db.sqlite.exec("PRAGMA ignore_check_constraints=ON");
  return { db, storage, failures, insert, event };
}

test("list isolates invalid rows and summary SQL tolerates malformed event and interaction JSON", () => {
  const f = fixture();
  try {
    for (const id of ["bad-row", "bad-event", "healthy"]) f.insert(id);
    f.event("bad-event");
    f.db.sqlite.exec(
      "UPDATE conversation SET status='corrupt' WHERE id='bad-row'; UPDATE conversation_event SET payload='{' WHERE conversation_id='bad-event'",
    );
    assert.deepEqual(
      f.storage.conversations.identities().map((row) => row.id),
      ["bad-event", "bad-row", "healthy"],
    );
    assert.deepEqual(
      f.storage.conversations
        .list({ projectId: "p" })
        .map((row) => row.id)
        .sort(),
      ["bad-event", "healthy"],
    );
    assert.deepEqual(
      f.storage.conversations.listAll().map((row) => row.id),
      ["bad-event", "healthy"],
    );
    assert.equal(
      f.storage.conversations.getSummary("bad-event")?.lastParentPromptAt,
      null,
    );
    assert.equal(
      f.db.sqlite
        .prepare("SELECT status FROM conversation WHERE id='bad-row'")
        .get()?.status,
      "corrupt",
    );
    assert.deepEqual(
      f.failures.map((failure) => [failure.conversationId, failure.operation]),
      [
        ["bad-row", "list"],
        ["bad-row", "listAll"],
      ],
    );
    assert.throws(() => f.storage.events.validate("bad-event"), SyntaxError);
    f.insert("bad-interaction");
    f.storage.toolCalls.insert({
      id: "call",
      conversationId: "bad-interaction",
      turnId: "turn",
      providerCallId: null,
      assistantEventId: null,
      contentIndex: null,
      origin: "user",
      toolName: "bash",
      arguments: {},
      state: "awaiting_approval",
      supervision: null,
      interaction: null,
      executionClaim: null,
      updatedAt: at,
    });
    f.db.sqlite.exec(
      "UPDATE tool_call SET state='awaiting_input', interaction='{' WHERE id='call'",
    );
    assert.deepEqual(
      f.storage.conversations
        .list({ projectId: "p" })
        .map((row) => row.id)
        .sort(),
      ["bad-event", "healthy"],
    );
    assert.ok(
      f.failures.some(
        (failure) => failure.conversationId === "bad-interaction",
      ),
    );
  } finally {
    f.storage.close();
  }
});

test("a broken ancestor does not undo child publication or suppress a healthy grandparent", () => {
  const f = fixture();
  try {
    f.insert("root");
    f.insert("broken", "root");
    f.insert("child", "broken");
    f.db.sqlite.exec(
      "UPDATE conversation SET status='corrupt' WHERE id='broken'",
    );
    const published: string[] = [];
    publishSummary(
      f.storage,
      (change) => published.push(change.summary.id),
      "child",
    );
    assert.deepEqual(published, ["child", "root"]);
    assert.equal(f.failures[0]?.conversationId, "broken");
    const status = new StatusService(
      f.storage,
      () => {},
      () => at,
      () => {},
      () => false,
    );
    assert.equal(status.refresh("broken"), false);
    assert.equal(f.failures.at(-1)?.operation, "status.refresh");
    assert.equal(
      f.db.sqlite
        .prepare("SELECT status FROM conversation WHERE id='broken'")
        .get()?.status,
      "corrupt",
    );
  } finally {
    f.storage.close();
  }
});

test("recovery validates raw identities independently and never recovers or wakes corrupt conversations", async () => {
  const f = fixture();
  try {
    for (const id of [
      "bad-row",
      "bad-event",
      "bad-type",
      "healthy",
      "wake-fails",
      "z-healthy",
    ])
      f.insert(id);
    f.event("bad-event");
    f.event("bad-type");
    f.db.sqlite.exec(
      "UPDATE conversation SET status='corrupt' WHERE id='bad-row'; UPDATE conversation_event SET payload='{' WHERE conversation_id='bad-event'; UPDATE conversation_event SET event_type='unknown' WHERE conversation_id='bad-type'",
    );
    const recovered: string[] = [],
      woken: string[] = [];
    let enabled = false;
    await recoverCore({
      storage: f.storage,
      toolCalls: {
        recover: async (id) => {
          recovered.push(id!);
        },
        openRows: () => [],
      },
      inputs: {
        recover: () => {},
        hasDeliverable: (id) => {
          if (id === "wake-fails") throw new Error("damaged input");
          return true;
        },
      },
      asyncBash: { recover: async () => {} },
      status: new StatusService(
        f.storage,
        () => {},
        () => at,
        () => {},
        () => false,
      ),
      scheduler: {
        enable: () => {
          enabled = true;
        },
        wake: (id) => {
          assert.equal(enabled, true);
          woken.push(id);
        },
      },
    });
    assert.deepEqual(recovered, ["healthy", "wake-fails", "z-healthy"]);
    assert.deepEqual(woken, ["healthy", "z-healthy"]);
    assert.deepEqual(
      f.failures.map((failure) => failure.conversationId),
      ["bad-event", "bad-row", "bad-type", "wake-fails"],
    );
    assert.equal(
      f.storage.conversations.get("bad-event")?.statusEventSequence,
      0,
    );
    assert.equal(
      f.db.sqlite
        .prepare("SELECT status FROM conversation WHERE id='bad-row'")
        .get()?.status,
      "corrupt",
    );
  } finally {
    f.storage.close();
  }
});
