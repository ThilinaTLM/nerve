import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  taskCancelToolResultSchema,
  taskEnvInfoSchema,
  taskLaunchConfigSchema,
  taskLogQueryResponseSchema,
  taskLogQuerySchema,
  taskRecordSchema,
  taskRestartToolResultSchema,
  taskStartToolResultSchema,
  taskStatusToolResultSchema,
  toolCallRecordSchema,
  toolNameSchema,
  type TaskRecord,
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
  it("strips raw env from public task records", () => {
    const parsed = taskRecordSchema.parse({
      ...record(),
      env: { API_TOKEN: "secret", PORT: "3000" },
    });

    assert.equal("env" in parsed, false);
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

describe("tool task result metadata", () => {
  it("rejects missing required task-tool payload fields", () => {
    assert.equal(taskStartToolResultSchema.safeParse({}).success, false);
    assert.equal(
      taskStartToolResultSchema.safeParse({
        task: record(),
        tasks: [record()],
      }).success,
      false,
    );
    assert.equal(taskStatusToolResultSchema.safeParse({}).success, false);
    assert.equal(
      taskCancelToolResultSchema.safeParse({ tasks: [] }).success,
      false,
    );
    assert.equal(
      taskRestartToolResultSchema.safeParse({ task: record() }).success,
      false,
    );
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
      status: "failed",
      revision: 1,
      attempt: 1,
      interactions: [],
      settledAt: "2026-01-02T03:04:06.000Z",
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

  it("keeps records for removed tools readable without making them active", () => {
    const parsed = toolCallRecordSchema.safeParse({
      id: "tool_legacy",
      agentId: "agent_test",
      conversationId: "conv_test",
      projectId: "proj_test",
      toolName: "task_list",
      risk: "read",
      args: { activeOnly: true },
      cwd: "/tmp/project",
      status: "completed",
      revision: 1,
      attempt: 1,
      interactions: [],
      settledAt: "2026-01-02T03:04:06.000Z",
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-01-02T03:04:06.000Z",
    });

    assert.equal(parsed.success, true);
    assert.equal(toolNameSchema.safeParse("task_list").success, false);
  });
});

describe("task log paging metadata", () => {
  it("accepts backward cursors and requires pagination flags", () => {
    assert.equal(
      taskLogQuerySchema.safeParse({
        mode: "recent",
        beforeSeq: 42,
        limit: 20,
      }).success,
      true,
    );
    assert.equal(
      taskLogQueryResponseSchema.safeParse({
        task: record(),
        events: [],
        nextCursor: 42,
        hasMoreBefore: true,
        hasMoreAfter: false,
        mode: "recent",
      }).success,
      true,
    );
    assert.equal(
      taskLogQueryResponseSchema.safeParse({
        task: record(),
        events: [],
        nextCursor: 42,
        mode: "recent",
      }).success,
      false,
    );
  });
});

describe("taskRecordSchema runtime metadata", () => {
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
