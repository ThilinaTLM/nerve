import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  taskCancelToolResultPreviewSchema,
  taskLogsToolResultPreviewSchema,
  taskRestartToolResultPreviewSchema,
  taskStartToolResultPreviewSchema,
  taskStatusToolResultPreviewSchema,
  taskToolSummarySchema,
  type TaskToolSummaryPayload,
} from "../src/index.js";

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
  it("accepts compact task state, termination, and lineage metadata", () => {
    const parsed = taskToolSummarySchema.parse(
      summary({
        status: "failed",
        timing: {
          startedAt: "2026-01-02T03:04:05.000Z",
          finishedAt: "2026-01-02T03:04:06.000Z",
        },
        termination: {
          exitCode: 1,
          signal: null,
          error: "process failed",
        },
        lineage: {
          groupId: "taskgrp_dev",
          restartedFromTaskId: "task_previous",
        },
      }),
    );

    assert.equal(parsed.termination?.exitCode, 1);
    assert.equal(parsed.termination?.signal, null);
    assert.equal(parsed.lineage?.restartedFromTaskId, "task_previous");
  });

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

  it("accepts start, status, logs, cancel, and restart previews", () => {
    const task = summary();
    const event = {
      seq: 1,
      ts: "2026-01-02T03:04:05.000Z",
      stream: "stdout" as const,
      level: "info" as const,
      line: "ready",
    };

    assert.equal(
      taskStartToolResultPreviewSchema.safeParse({ task }).success,
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
      taskCancelToolResultPreviewSchema.safeParse({
        outcomes: [
          {
            task: summary({ status: "cancelled" }),
            outcome: "cancelled",
            status: "cancelled",
            message: "dev cancelled with SIGTERM.",
          },
        ],
      }).success,
      true,
    );
    assert.equal(
      taskRestartToolResultPreviewSchema.safeParse({
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

  it("accepts valid empty collections and a task-less cancel outcome", () => {
    assert.equal(
      taskStatusToolResultPreviewSchema.safeParse({ tasks: [] }).success,
      true,
    );
    assert.equal(
      taskCancelToolResultPreviewSchema.safeParse({
        outcomes: [
          {
            outcome: "no_matching_active_task",
            message: "No matching tasks to cancel.",
          },
        ],
      }).success,
      true,
    );
    assert.equal(
      taskLogsToolResultPreviewSchema.safeParse({
        task: summary(),
        events: [],
        nextCursor: 0,
        mode: "warnings",
      }).success,
      true,
    );
  });
});
