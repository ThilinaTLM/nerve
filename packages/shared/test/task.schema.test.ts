import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  startTaskRequestSchema,
  type TaskRecord,
  taskActionResultSchema,
  taskEnvInfoSchema,
  taskLaunchConfigSchema,
  taskRecordSchema,
  toolCallRecordSchema,
} from "../src/index.js";

function record(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task_test",
    cwd: "/tmp/project",
    command: "pnpm dev",
    status: "running",
    readiness: { outcome: "pending" },
    stdoutPath: "/tmp/task/stdout.log",
    stderrPath: "/tmp/task/stderr.log",
    logsPath: "/tmp/task/logs.jsonl",
    startedAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
    ...overrides,
  };
}

describe("taskRecordSchema env metadata", () => {
  it("accepts redacted env metadata", () => {
    const parsed = taskRecordSchema.safeParse(
      record({
        envInfo: {
          keys: ["NODE_ENV", "PORT"],
          persisted: true,
          redacted: true,
        },
      }),
    );

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.deepEqual(parsed.data.envInfo?.keys, ["NODE_ENV", "PORT"]);
    }
  });

  it("strips raw env from public task records", () => {
    const parsed = taskRecordSchema.parse({
      ...record(),
      env: { API_TOKEN: "secret", PORT: "3000" },
    });

    assert.equal("env" in parsed, false);
  });

  it("keeps start requests compatible with raw env input", () => {
    const parsed = startTaskRequestSchema.parse({
      cwd: "/tmp/project",
      command: "pnpm dev",
      env: { PORT: "3000" },
    });

    assert.deepEqual(parsed.env, { PORT: "3000" });
  });

  it("accepts raw env in encrypted launch config storage schema", () => {
    const parsed = taskLaunchConfigSchema.parse({
      version: 1,
      env: { API_TOKEN: "secret", PORT: "3000" },
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-01-02T03:04:05.000Z",
    });

    assert.deepEqual(parsed.env, { API_TOKEN: "secret", PORT: "3000" });
  });

  it("rejects non-redacted public env metadata", () => {
    const parsed = taskEnvInfoSchema.safeParse({
      keys: ["PORT"],
      persisted: true,
      redacted: false,
    });

    assert.equal(parsed.success, false);
  });
});

describe("taskRecordSchema task ergonomics metadata", () => {
  it("accepts timed_out status, group IDs, readyUrl, and notifications", () => {
    const parsed = taskRecordSchema.safeParse(
      record({
        status: "timed_out",
        groupId: "taskgrp_test",
        groupName: "checks",
        readiness: {
          readyUrl: "http://127.0.0.1:5173/health",
          outcome: "timeout",
        },
        notifications: {
          enabled: true,
          ready: true,
          terminal: true,
          terminalEntryId: "entry_timeout",
          terminalDeliveredAt: "2026-01-02T03:04:06.000Z",
          outputTailLineCount: 12,
        },
      }),
    );

    assert.equal(parsed.success, true);
  });

  it("accepts readyUrl, group metadata, and notify in start requests", () => {
    const parsed = startTaskRequestSchema.parse({
      cwd: "/tmp/project",
      command: "pnpm dev",
      groupId: "taskgrp_test",
      groupName: "dev",
      readyUrl: "http://127.0.0.1:5173",
      notify: true,
    });

    assert.equal(parsed.groupId, "taskgrp_test");
    assert.equal(parsed.readyUrl, "http://127.0.0.1:5173");
    assert.equal(parsed.notify, true);
  });

  it("accepts restart lineage metadata", () => {
    const parsed = taskRecordSchema.safeParse(
      record({
        restartedFromTaskId: "task_previous",
        restartRootTaskId: "task_root",
        restartGeneration: 2,
      }),
    );

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.restartRootTaskId, "task_root");
      assert.equal(parsed.data.restartGeneration, 2);
    }
  });
});

describe("tool task result metadata", () => {
  it("accepts restart and cancellation action metadata", () => {
    const parsed = taskActionResultSchema.safeParse({
      task: record({ id: "task_new" }),
      tasks: [record({ id: "task_new" })],
      restartedFromTaskId: "task_old",
      newTaskId: "task_new",
      restartRootTaskId: "task_root",
      cancelResults: [
        {
          taskId: "task_old",
          taskName: "dev",
          requestedSignal: "SIGTERM",
          outcome: "cancelled",
          status: "cancelled",
          message: "dev cancelled with SIGTERM.",
        },
      ],
    });

    assert.equal(parsed.success, true);
  });

  it("accepts structured tool error metadata", () => {
    const parsed = toolCallRecordSchema.safeParse({
      id: "tool_test",
      agentId: "agent_test",
      conversationId: "conv_test",
      projectId: "proj_test",
      toolName: "task_status",
      risk: "read",
      args: { taskId: "missing" },
      cwd: "/tmp/project",
      status: "error",
      error: "Task 'missing' not found.",
      errorDetails: {
        code: "TASK_NOT_FOUND",
        message: "Task 'missing' not found.",
        details: { ref: "missing" },
      },
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-01-02T03:04:06.000Z",
    });

    assert.equal(parsed.success, true);
  });
});

describe("taskRecordSchema runtime metadata", () => {
  it("accepts records with valid runtime metadata", () => {
    const parsed = taskRecordSchema.safeParse(
      record({
        runtime: {
          platform: "linux",
          childPid: 1234,
          processGroupId: 1234,
          detached: true,
          shell: true,
          spawnedAt: "2026-01-02T03:04:06.000Z",
        },
      }),
    );

    assert.equal(parsed.success, true);
  });

  it("accepts older records without runtime metadata", () => {
    const parsed = taskRecordSchema.safeParse(record());

    assert.equal(parsed.success, true);
  });

  it("rejects invalid runtime PID values", () => {
    const parsed = taskRecordSchema.safeParse(
      record({
        runtime: {
          platform: "linux",
          childPid: -1,
          detached: true,
          shell: true,
          spawnedAt: "2026-01-02T03:04:06.000Z",
        },
      }),
    );

    assert.equal(parsed.success, false);
  });
});
