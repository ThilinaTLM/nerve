import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationRecord, ProjectRecord, TaskRecord } from "$lib/api";
import type { ConversationActivityState } from "$lib/domain/conversations/activity";
import {
  buildProjectSwitcherItems,
  projectActivitySignal,
  quickProjectItems,
  summarizeProjectActivity,
} from "./project-switcher";

function project(
  id: string,
  name: string,
  dir: string,
  updatedAt: string,
): ProjectRecord {
  return { id, name, dir, updatedAt, createdAt: updatedAt } as ProjectRecord;
}

function conversation(
  id: string,
  projectId: string,
  updatedAt: string,
  patch: Partial<ConversationRecord> = {},
): ConversationRecord {
  return {
    id,
    projectId,
    title: id,
    updatedAt,
    createdAt: updatedAt,
    lastUserMessageAt: updatedAt,
    ...patch,
  } as ConversationRecord;
}

function task(
  id: string,
  cwd: string,
  patch: Partial<TaskRecord> = {},
): TaskRecord {
  return {
    id,
    cwd,
    command: "pnpm dev",
    status: "running",
    visibility: "background",
    ...patch,
  } as TaskRecord;
}

function activity(
  input: Partial<ConversationActivityState>,
): ConversationActivityState {
  return {
    indicator: "idle",
    tone: "neutral",
    pulse: false,
    busy: false,
    needsUser: false,
    source: "none",
    ...input,
  };
}

test("summarizes active conversations and ignores completed activity", () => {
  const completedAt = "2026-01-04";
  const conversations = [
    conversation("error", "p", "2026-01-01"),
    conversation("waiting", "p", "2026-01-02"),
    conversation("running", "p", "2026-01-03"),
    conversation("completed-error", "p", completedAt, { completedAt }),
    conversation("completed-waiting", "p", completedAt, { completedAt }),
    conversation("completed-running", "p", completedAt, { completedAt }),
  ];
  assert.deepEqual(
    summarizeProjectActivity(conversations, {
      error: activity({ tone: "danger", busy: true }),
      waiting: activity({ tone: "warn", needsUser: true }),
      running: activity({ tone: "running", busy: true }),
      "completed-error": activity({ tone: "danger", busy: true }),
      "completed-waiting": activity({ tone: "warn", needsUser: true }),
      "completed-running": activity({ tone: "running", busy: true }),
    }),
    { needsUser: 1, failed: 1, running: 1 },
  );
});

test("combines project activity and background tasks into one priority signal", () => {
  assert.equal(
    projectActivitySignal(
      { needsUser: 0, failed: 0, running: 0 },
      { running: 0 },
    ),
    undefined,
  );
  assert.deepEqual(
    projectActivitySignal(
      { needsUser: 1, failed: 2, running: 3 },
      { running: 4 },
    ),
    {
      tone: "warn",
      count: 10,
      summary:
        "1 waiting for you, 2 failed, 3 conversations running, 4 background tasks running",
    },
  );
  assert.deepEqual(
    projectActivitySignal(
      { needsUser: 0, failed: 1, running: 2 },
      { running: 0 },
    ),
    {
      tone: "danger",
      count: 3,
      summary: "1 failed, 2 conversations running",
    },
  );
  assert.deepEqual(
    projectActivitySignal(
      { needsUser: 0, failed: 0, running: 1 },
      { running: 1 },
    ),
    {
      tone: "running",
      count: 2,
      summary: "1 conversation running, 1 background task running",
    },
  );
});

test("groups aliases and aggregates their conversations", () => {
  const projects = [
    project("p1", "app", "/work/one/app", "2026-01-01"),
    project("p2", "app alias", "/work/one/app/", "2026-01-02"),
    project("p3", "app", "/work/two/app", "2026-01-03"),
  ];
  const items = buildProjectSwitcherItems({
    projects,
    conversations: [
      conversation("c1", "p1", "2026-01-04"),
      conversation("c2", "p2", "2026-01-05"),
    ],
    tasks: [],
    activityById: {},
  });
  assert.equal(items.length, 2);
  const aliased = items.find((item) => item.key === "/work/one/app");
  assert.deepEqual(aliased?.projectIds, ["p1", "p2"]);
  assert.equal(aliased?.conversationCount, 2);
  assert.ok(items.every((item) => item.label !== "app"));
});

test("derives project recency from user prompts instead of later conversation updates", () => {
  const items = buildProjectSwitcherItems({
    projects: [
      project("p1", "One", "/one", "2026-01-01"),
      project("p2", "Two", "/two", "2026-01-01"),
    ],
    conversations: [
      conversation("c1", "p1", "2026-01-05", {
        createdAt: "2026-01-01",
        lastUserMessageAt: "2026-01-02",
      }),
      conversation("c2", "p2", "2026-01-04", {
        createdAt: "2026-01-01",
        lastUserMessageAt: "2026-01-03",
      }),
    ],
    tasks: [],
    activityById: {},
  });

  assert.deepEqual(
    items.map((item) => item.key),
    ["/two", "/one"],
  );
  assert.equal(items.find((item) => item.key === "/one")?.sortAt, "2026-01-02");
});

test("counts only active background tasks and resolves legacy cwd by longest path", () => {
  const items = buildProjectSwitcherItems({
    projects: [
      project("outer", "work", "/work", "2026-01-01"),
      project("inner", "app", "/work/app", "2026-01-02"),
      project("inner-alias", "app alias", "/work/app/", "2026-01-03"),
    ],
    conversations: [],
    tasks: [
      task("task_owned", "/elsewhere", { projectId: "inner" }),
      task("task_legacy", "/work/app/packages/api"),
      task("task_foreground", "/work/app", { visibility: "foreground" }),
      task("task_done", "/work/app", { status: "completed" }),
    ],
    activityById: {},
  });

  assert.equal(
    items.find((item) => item.key === "/work/app")?.tasks.running,
    2,
  );
  assert.equal(items.find((item) => item.key === "/work")?.tasks.running, 0);
});

test("exposes access time and preserves quick-project selection and alphabetization", () => {
  const items = buildProjectSwitcherItems({
    projects: [
      project("z", "Zulu", "/zulu", "2026-01-03"),
      project("a", "Alpha", "/alpha", "2026-01-02"),
      project("m", "Mike", "/mike", "2026-01-01"),
    ],
    conversations: [],
    tasks: [],
    activityById: {},
    recency: { "/alpha": 1_786_249_800_000 },
  });
  assert.equal(
    items.find((item) => item.key === "/alpha")?.lastAccessedAt,
    1_786_249_800_000,
  );
  assert.deepEqual(
    quickProjectItems(items, undefined, 2).map((item) => item.label),
    ["alpha", "zulu"],
  );
  assert.deepEqual(
    quickProjectItems(items, "/mike", 2).map((item) => item.key),
    ["/alpha", "/mike"],
  );
});
