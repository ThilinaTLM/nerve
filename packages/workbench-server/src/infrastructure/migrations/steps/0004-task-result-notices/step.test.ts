import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { openCoreStorage } from "@nervekit/conversation-core";
import { createStepContext } from "../../framework/context.js";
import { storagePaths } from "../../../storage-bootstrap/paths.js";
import { DiscardableMigrationError } from "../../framework/step.js";
import { finishPhase, startPhase } from "../../framework/toolkit.js";
import step from "./step.js";

const now = "2026-10-10T00:00:00.000Z";

function home() {
  const root = mkdtempSync(join(tmpdir(), "nerve-0004-"));
  const paths = storagePaths(root);
  mkdirSync(paths.dataPath, { recursive: true });
  const storage = openCoreStorage(paths.sqlitePath);
  storage.projects.insert({
    id: "proj_1",
    name: "Test",
    directory: root,
    createdAt: now,
    updatedAt: now,
  });
  storage.conversations.insert(
    {
      id: "conv_1",
      projectId: "proj_1",
      parentConversationId: null,
      parentToolCallId: null,
      headEventId: null,
      title: "Test",
      status: "idle",
      statusEventSequence: 0,
      statusClearedAt: null,
      paused: false,
      nextInputSequence: 1,
      pinnedAt: null,
      completedAt: null,
      lastUserMessageAt: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      conversationId: "conv_1",
      model: { provider: "test", modelId: "test" },
      reasoningLevel: "off",
      systemPrompt: null,
      instructions: null,
      permissionRuleSetId: "baseline",
      agentProfile: "coding",
      workingDirectory: root,
    },
  );
  storage.close();
  const { context } = createStepContext(
    paths,
    step.id,
    step.description,
    () => {},
  );
  return { root, paths, context };
}

const bashNotice = (status: string, exitCode: number | null) => ({
  subtype: "async_bash_event",
  producer: "async_bash",
  bashId: "bash_1",
  status,
  exitCode,
  text: "done",
  assetIds: ["asset_1"],
});
const subagentNotice = {
  subtype: "sub_conversation_event",
  producer: "delegation",
  childConversationId: "conv_child",
  assignmentId: "assign_1",
  status: "interrupted",
  text: "stopped",
  assetIds: [],
};

function withNotices() {
  const fixture = home();
  const db = new DatabaseSync(fixture.paths.sqlitePath);
  const insertEvent = db.prepare(
    `INSERT INTO conversation_event (id, conversation_id, sequence, previous_event_id, event_type,
       llm_representation, payload, created_at) VALUES (?, 'conv_1', ?, ?, 'system_event', 'user', ?, ?)`,
  );
  const events: Array<[string, unknown]> = [
    ["evt_1", bashNotice("lost", null)],
    ["evt_2", subagentNotice],
    ["evt_3", bashNotice("completed", 0)],
    ["evt_4", { subtype: "notification", producer: "x", text: "hi" }],
  ];
  events.forEach(([id, payload], index) =>
    insertEvent.run(
      id,
      index + 1,
      index ? events[index - 1][0] : null,
      JSON.stringify(payload),
      now,
    ),
  );
  db.prepare(
    `INSERT INTO input_queue (input_id, conversation_id, acceptance_sequence, source, content,
       delivery_target, wake_when_idle, accepted_at)
     VALUES ('input_1', 'conv_1', 1, 'system', ?, 'next_turn', 1, ?)`,
  ).run(JSON.stringify(bashNotice("timed_out", 124)), now);
  const payloads = () =>
    Object.fromEntries(
      (
        db
          .prepare(
            "SELECT id, payload FROM conversation_event ORDER BY sequence",
          )
          .all() as Array<{ id: string; payload: string }>
      ).map((row) => [row.id, JSON.parse(row.payload)]),
    );
  const queued = () =>
    JSON.parse(
      (
        db.prepare("SELECT content FROM input_queue").get() as {
          content: string;
        }
      ).content,
    );
  return { ...fixture, db, payloads, queued };
}

void test("rewrites old task notices in events and queued inputs, and reruns as a no-op", async (t) => {
  const { root, db, context, payloads, queued } = withNotices();
  t.after(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  const before = payloads();
  await step.run(context);
  await step.verify!(context);
  const after = payloads();
  assert.deepEqual(after.evt_1, {
    subtype: "task_result",
    producer: "async_bash",
    task: { kind: "bash", id: "bash_1", exitCode: null },
    outcome: "interrupted",
    text: "done",
    assetIds: ["asset_1"],
  });
  assert.deepEqual(after.evt_2, {
    subtype: "task_result",
    producer: "delegation",
    task: { kind: "subagent", id: "conv_child", assignmentId: "assign_1" },
    outcome: "interrupted",
    text: "stopped",
    assetIds: [],
  });
  assert.equal((after.evt_3 as { outcome: string }).outcome, "completed");
  assert.deepEqual(after.evt_4, before.evt_4);
  assert.deepEqual(queued().task, {
    kind: "bash",
    id: "bash_1",
    exitCode: 124,
  });
  assert.equal(queued().outcome, "timed_out");
  await step.run(context);
  assert.deepEqual(payloads(), after);
});

void test("a malformed notice fails its conversation and is set aside only on request", async (t) => {
  const { root, db, context, payloads } = withNotices();
  t.after(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  db.prepare(
    "UPDATE conversation_event SET payload = ? WHERE id = 'evt_3'",
  ).run(JSON.stringify({ subtype: "async_bash_event", producer: 7 }));
  const before = payloads();
  startPhase(context, "run");
  await step.run(context);
  assert.throws(() => finishPhase(context), DiscardableMigrationError);
  // The conversation's transaction rolled back as a whole.
  assert.deepEqual(payloads(), before);
  writeFileSync(
    join(context.scratchDir, "discarded.json"),
    JSON.stringify(["conv_1"]),
  );
  const { context: retry } = createStepContext(
    storagePaths(root),
    step.id,
    step.description,
    () => {},
  );
  startPhase(retry, "run");
  await step.run(retry);
  finishPhase(retry);
  const after = payloads();
  assert.equal((after.evt_1 as { subtype: string }).subtype, "task_result");
  assert.equal((after.evt_3 as { subtype: string }).subtype, "notification");
  await step.verify!(retry);
});

void test("rollback restores the original notices", async (t) => {
  const { root, db, context, payloads, queued } = withNotices();
  t.after(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  const before = payloads();
  await step.run(context);
  await step.rollback!(context);
  assert.deepEqual(payloads(), before);
  assert.equal(queued().subtype, "async_bash_event");
  assert.equal(queued().status, "timed_out");
});
