import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  taskControlToolResultPreviewSchema,
  taskLogsToolResultPreviewSchema,
  taskStartToolResultPreviewSchema,
  taskStatusToolResultPreviewSchema,
  taskToolSummarySchema,
  type TaskToolSummaryPayload,
} from "../../src/index.js";

function summary(
  overrides: Partial<TaskToolSummaryPayload> = {},
): TaskToolSummaryPayload {
  return {
    id: "task_preview",
    name: "dev",
    cwd: "/tmp/project",
    command: "pnpm dev",
    status: "running",
    readiness: {
      outcome: "ready",
      readyUrl: "http://127.0.0.1:5173",
      readyOnUrl: true,
      matched: "http://127.0.0.1:5173",
    },
    timing: { startedAt: "2026-01-02T03:04:05.000Z" },
    ...overrides,
  };
}

describe("task tool transcript preview contracts", () => {
  it("keeps transcript summaries strict and free of full task internals", () => {
    assert.equal(
      taskToolSummarySchema.safeParse({
        ...summary(),
        stdoutPath: "/tmp/task/stdout.log",
      }).success,
      false,
    );
    assert.equal(
      taskToolSummarySchema.safeParse({
        id: "task_missing_state",
        command: "pnpm dev",
      }).success,
      false,
    );
  });

  it("accepts start, status, logs, stop, and restart previews", () => {
    const task = summary();
    const event = {
      seq: 1,
      ts: "2026-01-02T03:04:05.000Z",
      stream: "stdout" as const,
      level: "info" as const,
      line: "ready",
    };

    assert.equal(
      taskStartToolResultPreviewSchema.safeParse({
        task,
        otherActiveTasks: [summary({ id: "task_peer" })],
        otherActiveTaskCount: 1,
      }).success,
      true,
    );
    assert.equal(
      taskStatusToolResultPreviewSchema.safeParse({ tasks: [task] }).success,
      true,
    );
    assert.equal(
      taskLogsToolResultPreviewSchema.safeParse({
        task,
        events: [event],
        nextCursor: 1,
        mode: "recent",
      }).success,
      true,
    );
    assert.equal(
      taskControlToolResultPreviewSchema.safeParse({
        action: "stop",
        outcome: {
          task: summary({ status: "cancelled" }),
          outcome: "cancelled",
          status: "cancelled",
          message: "dev cancelled with SIGTERM.",
        },
      }).success,
      true,
    );
    assert.equal(
      taskControlToolResultPreviewSchema.safeParse({
        action: "restart",
        task: summary({
          id: "task_new",
          lineage: { restartedFromTaskId: "task_old" },
        }),
        restartedFromTaskId: "task_old",
        newTaskId: "task_new",
        restartRootTaskId: "task_root",
      }).success,
      true,
    );
  });
});
