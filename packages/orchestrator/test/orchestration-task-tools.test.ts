import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  defaultSettings,
  type TaskLogQuery,
  type TaskRecord,
  type ToolCallRecord,
} from "@nervekit/contracts";
import { OrchestrationToolDispatcher } from "../src/domains/tools/orchestration-tool-dispatcher.js";
import { CodedToolError } from "../src/domains/tools/tool-errors.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("orchestration task tools", () => {
  it("lists active project tasks without a conversation by default", async () => {
    const projectTask = task({
      id: "task_project_scoped",
      name: "web-dev",
      status: "running",
      conversationId: undefined,
      agentId: undefined,
    });
    const otherProjectTask = task({
      id: "task_other_project",
      status: "running",
      projectId: "proj_other",
      conversationId: undefined,
      agentId: undefined,
    });
    const dispatcher = await createDispatcher([projectTask, otherProjectTask]);

    const result = (await dispatcher.execute(toolCall("task_list"), {
      activeOnly: true,
    })) as { tasks: TaskRecord[] };

    assert.deepEqual(
      result.tasks.map((item) => item.id),
      [projectTask.id],
    );
  });

  it("inspects active project tasks without a conversation by default", async () => {
    const projectTask = task({
      id: "task_project_scoped",
      name: "web-dev",
      status: "running",
      conversationId: undefined,
      agentId: undefined,
    });
    const otherProjectTask = task({
      id: "task_other_project",
      status: "running",
      projectId: "proj_other",
      conversationId: undefined,
      agentId: undefined,
    });
    const dispatcher = await createDispatcher([projectTask, otherProjectTask]);

    const result = (await dispatcher.execute(toolCall("task_status"), {
      activeOnly: true,
    })) as { tasks: Array<{ task: TaskRecord }> };

    assert.deepEqual(
      result.tasks.map((item) => item.task.id),
      [projectTask.id],
    );
  });

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

  it("routes bash through foreground auto-promotion with current agent scope", async () => {
    let captured: Record<string, unknown> | undefined;
    const dispatcher = await createDispatcher([], {
      runForegroundBashWithPromotion: async (input) => {
        captured = input as Record<string, unknown>;
        return {
          kind: "completed_foreground",
          result: {
            content: "ok",
            contentBlocks: [{ type: "text", text: "ok" }],
            exitCode: 0,
          },
        };
      },
    });

    const result = (await dispatcher.execute(toolCall("bash"), {
      command: "pnpm check",
      timeout: 0,
    })) as { content?: string };

    assert.equal(result.content, "ok");
    assert.equal(captured?.command, "pnpm check");
    assert.equal(captured?.timeoutMs, undefined);
    assert.equal(captured?.projectId, "proj_test");
    assert.equal(captured?.conversationId, "conv_test");
    assert.equal(captured?.agentId, "agent_test");
    assert.equal(captured?.workerId, "worker_test");
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

  it("warns when orphan cleanup releases listening ports", async () => {
    const orphaned = task({
      id: "task_orphaned",
      name: "dev",
      status: "orphaned",
    });
    const cancelled = task({
      ...orphaned,
      status: "cancelled",
      signal: "SIGTERM",
      lastOrphanCleanupReleasedPorts: [
        {
          protocol: "tcp",
          address: "127.0.0.1",
          port: 3000,
          pid: 1234,
          detectedAt: "2026-01-02T03:04:06.000Z",
        },
      ],
    });
    const dispatcher = await createDispatcher([orphaned], {
      cancelTask: async () => cancelled,
    });

    const result = (await dispatcher.execute(toolCall("task_cancel"), {
      taskId: orphaned.id,
    })) as {
      cancelResults: Array<{
        outcome: string;
        message: string;
        releasedPorts?: Array<{ port: number }>;
      }>;
    };

    assert.equal(result.cancelResults[0]?.outcome, "cancelled");
    assert.equal(result.cancelResults[0]?.releasedPorts?.[0]?.port, 3000);
    assert.match(
      result.cancelResults[0]?.message ?? "",
      /⚠ Released listening port\(s\): 127\.0\.0\.1:3000\/tcp/,
    );
  });
});

async function createDispatcher(
  records: TaskRecord[],
  overrides: Partial<{
    restartTask: (taskId: string) => Promise<TaskRecord>;
    cancelTask: (taskId: string) => Promise<TaskRecord>;
    runForegroundBashWithPromotion: (input: unknown) => Promise<unknown>;
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
    runForegroundBashWithPromotion:
      overrides.runForegroundBashWithPromotion ??
      (async () => ({
        kind: "completed_foreground",
        result: {
          content: "ok",
          contentBlocks: [{ type: "text", text: "ok" }],
        },
      })),
  };

  return new OrchestrationToolDispatcher({
    storage: { paths: { home: root }, settings: defaultSettings },
    events: {},
    tasks,
    pythonRuntime: {},
    startTask: async () => task({ id: "task_started" }),
    getAgent: () => ({
      id: "agent_test",
      workerId: "worker_test",
      projectDir: root,
      mode: "coding",
    }),
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
