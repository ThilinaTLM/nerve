import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationRecord } from "@nervekit/contracts/conversations";
import type { TaskRecord } from "@nervekit/contracts/tasks";
import {
  buildMobileActivity,
  taskProject,
  tasksInProject,
} from "./mobile-activity.js";

const NOW = Date.parse("2026-01-10T12:00:00.000Z");

function conversation(
  id: string,
  overrides: Partial<ConversationRecord> = {},
): ConversationRecord {
  return {
    id,
    projectId: "proj_a",
    title: `Conversation ${id}`,
    mode: "code",
    permissionLevel: "standard",
    createdAt: "2026-01-10T00:00:00.000Z",
    updatedAt: "2026-01-10T10:00:00.000Z",
    ...overrides,
  } as ConversationRecord;
}

function task(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    cwd: "/work/app",
    command: "pnpm dev",
    status: "running",
    startedAt: "2026-01-10T09:00:00.000Z",
    updatedAt: "2026-01-10T09:00:00.000Z",
    ...overrides,
  } as TaskRecord;
}

const projects = [
  { id: "proj_a", name: "app", dir: "/work/app" },
  { id: "proj_b", name: "web", dir: "/work/app/web" },
];

describe("buildMobileActivity", () => {
  it("orders live conversations running first and drops quiet ones", () => {
    const model = buildMobileActivity({
      now: NOW,
      projects,
      tasks: [],
      conversations: [
        conversation("conv_idle"),
        conversation("conv_error"),
        conversation("conv_async"),
        conversation("conv_run", { projectId: "proj_b" }),
        conversation("conv_old_error", {
          updatedAt: "2026-01-08T00:00:00.000Z",
        }),
      ],
      activityById: {
        conv_idle: { indicator: "idle", tone: "neutral", busy: false },
        conv_error: {
          indicator: "error",
          tone: "destructive",
          label: "Provider error",
          busy: false,
        },
        conv_async: {
          indicator: "awaiting-async",
          tone: "warning",
          busy: false,
        },
        conv_run: { indicator: "running", tone: "info", busy: true },
        conv_old_error: {
          indicator: "error",
          tone: "destructive",
          busy: false,
        },
      },
    });

    assert.deepEqual(
      model.conversations.map((row) => row.conversationId),
      ["conv_run", "conv_async", "conv_error"],
    );
    assert.equal(model.conversations[0]?.projectLabel, "web");
    assert.equal(model.conversations[0]?.pulse, true);
    assert.equal(model.conversations[1]?.detail, "Waiting for background work");
    assert.equal(model.conversations[2]?.detail, "Provider error");
  });

  it("lists only live tasks, newest first, labelled by project", () => {
    const model = buildMobileActivity({
      now: NOW,
      projects,
      conversations: [],
      activityById: {},
      tasks: [
        task("task_done", { status: "completed" }),
        task("task_old", { displayName: "API server" }),
        task("task_new", {
          cwd: "/work/app/web/src",
          status: "ready",
          startedAt: "2026-01-10T11:00:00.000Z",
        }),
      ],
    });

    assert.deepEqual(
      model.tasks.map((row) => [row.taskId, row.title, row.projectLabel]),
      [
        ["task_new", "pnpm dev", "web"],
        ["task_old", "API server", "app"],
      ],
    );
    assert.equal(model.tasks[0]?.pulse, false);
    assert.equal(model.tasks[1]?.pulse, true);
  });

  it("prefers the recorded project over directory matching", () => {
    assert.equal(
      taskProject(
        task("task_x", { projectId: "proj_a", cwd: "/work/app/web" }),
        projects,
      )?.id,
      "proj_a",
    );
    assert.equal(
      taskProject(task("task_y", { cwd: "/elsewhere" }), projects),
      undefined,
    );
  });

  it("gives a nested project's legacy tasks to the child only", () => {
    const tasks = [
      task("task_parent", { cwd: "/work/app/src" }),
      task("task_child", { cwd: "/work/app/web/src" }),
    ];
    assert.deepEqual(
      tasksInProject(tasks, projects, "proj_a").map((item) => item.id),
      ["task_parent"],
    );
    assert.deepEqual(
      tasksInProject(tasks, projects, "proj_b").map((item) => item.id),
      ["task_child"],
    );
  });
});
