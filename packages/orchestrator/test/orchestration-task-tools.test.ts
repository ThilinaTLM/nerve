import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { TaskLogQuery, TaskRecord, ToolCallRecord } from "@nerve/shared";
import { OrchestrationToolDispatcher } from "../src/domains/tools/orchestration-tool-dispatcher.js";
import { CodedToolError } from "../src/domains/tools/tool-errors.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("orchestration task tools", () => {
  it("resolves restarted same-lineage task names to the latest generation", async () => {
    const rootTask = task({
      id: "task_root",
      name: "dev",
      restartRootTaskId: "task_root",
      restartGeneration: 0,
      startedAt: "2026-01-02T03:04:05.000Z",
    });
    const restarted = task({
      id: "task_restart",
      name: "dev",
      restartedFromTaskId: "task_root",
      restartRootTaskId: "task_root",
      restartGeneration: 1,
      startedAt: "2026-01-02T03:04:06.000Z",
    });
    const dispatcher = await createDispatcher([rootTask, restarted]);

    const result = (await dispatcher.execute(toolCall("task_status"), {
      taskId: "dev",
    })) as { tasks: Array<{ task: TaskRecord }> };

    assert.equal(result.tasks[0]?.task.id, restarted.id);
  });

  it("keeps unrelated same-name tasks ambiguous with structured details", async () => {
    const first = task({ id: "task_first", name: "dev" });
    const second = task({
      id: "task_second",
      name: "dev",
      startedAt: "2026-01-02T03:04:06.000Z",
    });
    const dispatcher = await createDispatcher([first, second]);

    await assert.rejects(
      () => dispatcher.execute(toolCall("task_status"), { taskId: "dev" }),
      (error) => {
        assert.ok(error instanceof CodedToolError);
        assert.equal(error.code, "TASK_NAME_AMBIGUOUS");
        assert.equal(
          Array.isArray(error.details.matches),
          true,
          "expected match metadata",
        );
        return true;
      },
    );
  });

  it("returns explicit restart metadata with the new task id", async () => {
    const original = task({ id: "task_original", name: "dev" });
    const restarted = task({
      id: "task_new",
      name: "dev",
      restartedFromTaskId: original.id,
      restartRootTaskId: original.id,
      restartGeneration: 1,
    });
    const dispatcher = await createDispatcher([original], {
      restartTask: async () => restarted,
    });

    const result = (await dispatcher.execute(toolCall("task_restart"), {
      taskId: original.id,
    })) as {
      task: TaskRecord;
      newTaskId: string;
      restartedFromTaskId: string;
      restartRootTaskId: string;
    };

    assert.equal(result.task.id, restarted.id);
    assert.equal(result.newTaskId, restarted.id);
    assert.equal(result.restartedFromTaskId, original.id);
    assert.equal(result.restartRootTaskId, original.id);
  });

  it("returns cancellation outcome metadata for terminal targets", async () => {
    const completed = task({
      id: "task_done",
      name: "done",
      status: "completed",
    });
    const dispatcher = await createDispatcher([completed], {
      cancelTask: async () => completed,
    });

    const result = (await dispatcher.execute(toolCall("task_cancel"), {
      taskId: completed.id,
    })) as { cancelResults: Array<{ outcome: string; message: string }> };

    assert.equal(result.cancelResults[0]?.outcome, "already_terminal");
    assert.match(result.cancelResults[0]?.message ?? "", /already completed/);
  });
});

async function createDispatcher(
  records: TaskRecord[],
  overrides: Partial<{
    restartTask: (taskId: string) => Promise<TaskRecord>;
    cancelTask: (taskId: string) => Promise<TaskRecord>;
  }> = {},
): Promise<OrchestrationToolDispatcher> {
  const root = await mkdtemp(join(tmpdir(), "nerve-task-dispatcher-"));
  roots.push(root);
  const byId = new Map(records.map((record) => [record.id, record]));
  const tasks = {
    listTasks: () => [...byId.values()],
    getTask(taskId: string) {
      const record = byId.get(taskId);
      if (!record) throw new Error("Task not found.");
      return record;
    },
    queryLogs: async (taskId: string, query: TaskLogQuery = {}) => ({
      task: tasks.getTask(taskId),
      events: [],
      nextCursor: 0,
      mode: query.mode ?? "recent",
    }),
    restartTask:
      overrides.restartTask ??
      (async (taskId: string) => {
        const record = tasks.getTask(taskId);
        const restarted = task({
          ...record,
          id: "task_restarted",
          restartedFromTaskId: record.id,
          restartRootTaskId: record.restartRootTaskId ?? record.id,
          restartGeneration: (record.restartGeneration ?? 0) + 1,
        });
        byId.set(restarted.id, restarted);
        return restarted;
      }),
    cancelTask:
      overrides.cancelTask ?? (async (taskId: string) => tasks.getTask(taskId)),
  };

  return new OrchestrationToolDispatcher({
    storage: { paths: { home: root } },
    events: {},
    tasks,
    pythonRuntime: {},
    startTask: async () => task({ id: "task_started" }),
    getAgent: () => ({ id: "agent_test", projectDir: root, mode: "coding" }),
    runExplore: async () => ({ reports: [] }),
    getApiKey: async () => undefined,
    plans: {},
    setAgentMode: async () => ({
      id: "agent_test",
      projectDir: root,
      mode: "coding",
    }),
    conversationRuntime: {},
    todoState: { set() {}, get: () => [] },
    interactionSessions: {},
    updateToolCall: async (id: string, patch: Partial<ToolCallRecord>) => ({
      ...toolCall("task_status"),
      id,
      ...patch,
    }),
    publishToolCallUpdated: async () => undefined,
  } as never);
}

function toolCall(toolName: ToolCallRecord["toolName"]): ToolCallRecord {
  return {
    id: "tool_test",
    agentId: "agent_test",
    conversationId: "conv_test",
    projectId: "proj_test",
    toolName,
    risk: "read",
    args: {},
    cwd: "/tmp/project",
    status: "running",
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
  };
}

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  const id = overrides.id ?? "task_test";
  return {
    id,
    name: "task",
    projectId: "proj_test",
    conversationId: "conv_test",
    agentId: "agent_test",
    cwd: "/tmp/project",
    command: "echo test",
    status: "completed",
    readiness: { outcome: "none" },
    stdoutPath: `/tmp/${id}/stdout.log`,
    stderrPath: `/tmp/${id}/stderr.log`,
    logsPath: `/tmp/${id}/logs.jsonl`,
    startedAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
    ...overrides,
  };
}
