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
  it("lists user-started tasks in the current cwd tree regardless of lineage", async () => {
    const rootTask = task({
      id: "task_user_root",
      name: "root-dev",
      status: "running",
      projectId: undefined,
      conversationId: undefined,
      agentId: undefined,
      origin: { kind: "api" },
    });
    const nestedTask = task({
      id: "task_user_nested",
      name: "nested-dev",
      status: "running",
      projectId: "proj_other",
      conversationId: undefined,
      agentId: undefined,
      cwd: "/tmp/project/apps/web",
      origin: { kind: "api" },
    });
    const dotPrefixedNestedTask = task({
      id: "task_dot_prefixed_nested",
      status: "running",
      cwd: "/tmp/project/..cache",
    });
    const outOfScopeTasks = [
      task({
        id: "task_parent",
        status: "running",
        cwd: "/tmp",
      }),
      task({
        id: "task_sibling",
        status: "running",
        cwd: "/tmp/sibling",
      }),
      task({
        id: "task_prefix_collision",
        status: "running",
        cwd: "/tmp/project-other",
      }),
    ];
    const dispatcher = await createDispatcher([
      rootTask,
      nestedTask,
      dotPrefixedNestedTask,
      ...outOfScopeTasks,
    ]);

    const result = (await dispatcher.execute(toolCall("task_status"), {})) as {
      tasks: TaskRecord[];
    };

    assert.deepEqual(
      result.tasks.map((item) => item.id),
      [rootTask.id, nestedTask.id, dotPrefixedNestedTask.id],
    );
  });

  it("inspects user-started tasks in nested cwd directories by default", async () => {
    const nestedTask = task({
      id: "task_user_nested",
      name: "web-dev",
      status: "running",
      projectId: undefined,
      conversationId: undefined,
      agentId: undefined,
      cwd: "/tmp/project/apps/web",
      origin: { kind: "api" },
    });
    const siblingTask = task({
      id: "task_sibling",
      status: "running",
      cwd: "/tmp/project-sibling",
    });
    const dispatcher = await createDispatcher([nestedTask, siblingTask]);

    const result = (await dispatcher.execute(toolCall("task_status"), {})) as {
      tasks: TaskRecord[];
    };

    assert.deepEqual(
      result.tasks.map((item) => item.id),
      [nestedTask.id],
    );
  });

  it("returns terminal history with status all only within the cwd scope", async () => {
    const inScope = task({
      id: "task_other_project_nested",
      projectId: "proj_other",
      cwd: "/tmp/project/packages/app",
    });
    const outOfScope = task({
      id: "task_other_project_sibling",
      projectId: "proj_other",
      cwd: "/tmp/project-sibling",
    });
    const dispatcher = await createDispatcher([inScope, outOfScope]);

    const result = (await dispatcher.execute(toolCall("task_status"), {
      status: "all",
    })) as { tasks: TaskRecord[] };

    assert.deepEqual(
      result.tasks.map((item) => item.id),
      [inScope.id],
    );
  });

  it("resolves in-scope user tasks by id and name", async () => {
    const userTask = task({
      id: "task_user_nested",
      name: "user-dev",
      projectId: undefined,
      conversationId: undefined,
      agentId: undefined,
      cwd: "/tmp/project/apps/web",
      origin: { kind: "api" },
    });
    const dispatcher = await createDispatcher([userTask]);

    const byId = (await dispatcher.execute(toolCall("task_status"), {
      taskId: userTask.id,
    })) as { tasks: TaskRecord[] };
    const byName = (await dispatcher.execute(toolCall("task_status"), {
      taskId: userTask.name,
    })) as { tasks: TaskRecord[] };

    assert.equal(byId.tasks[0]?.id, userTask.id);
    assert.equal(byName.tasks[0]?.id, userTask.id);
  });

  it("rejects direct references to tasks outside the cwd scope", async () => {
    const outOfScope = task({
      id: "task_same_project_sibling",
      cwd: "/tmp/project-sibling",
    });
    const dispatcher = await createDispatcher([outOfScope]);

    await assert.rejects(
      () =>
        dispatcher.execute(toolCall("task_status"), {
          taskId: outOfScope.id,
        }),
      (error) => {
        assert.ok(error instanceof CodedToolError);
        assert.equal(error.code, "TASK_OUT_OF_SCOPE");
        assert.equal(error.details.scopeCwd, "/tmp/project");
        assert.equal(error.details.taskCwd, outOfScope.cwd);
        return true;
      },
    );
  });

  it("scopes Windows task paths independently of the server host OS", async () => {
    const rootTask = task({ id: "task_windows_root", cwd: "C:\\repo" });
    const nestedTask = task({
      id: "task_windows_nested",
      cwd: "C:\\repo\\packages\\app",
    });
    const siblingTask = task({
      id: "task_windows_sibling",
      cwd: "C:\\repo-other",
    });
    const dispatcher = await createDispatcher([
      rootTask,
      nestedTask,
      siblingTask,
    ]);

    const result = (await dispatcher.execute(
      { ...toolCall("task_status"), cwd: "C:\\repo" },
      { status: "all" },
    )) as { tasks: TaskRecord[] };

    assert.deepEqual(
      result.tasks.map((item) => item.id),
      [rootTask.id, nestedTask.id],
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
    })) as { tasks: TaskRecord[] };

    assert.equal(result.tasks[0]?.id, restarted.id);
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

  it("filters task_status by a concrete terminal status", async () => {
    const completed = task({ id: "task_completed", status: "completed" });
    const failed = task({ id: "task_failed", status: "failed" });
    const running = task({ id: "task_running", status: "running" });
    const dispatcher = await createDispatcher([completed, failed, running]);

    const result = (await dispatcher.execute(toolCall("task_status"), {
      status: "failed",
    })) as { tasks: TaskRecord[] };

    assert.deepEqual(
      result.tasks.map((item) => item.id),
      [failed.id],
    );
  });

  it("requires explicit log and cancellation targets", async () => {
    const dispatcher = await createDispatcher([]);
    await assert.rejects(
      () => dispatcher.execute(toolCall("task_logs"), {}),
      /taskId/,
    );
    await assert.rejects(
      () => dispatcher.execute(toolCall("task_cancel"), {}),
      /required/,
    );
  });

  it("deduplicates bulk cancellation while preserving first-seen order", async () => {
    const first = task({ id: "task_first", status: "running" });
    const second = task({ id: "task_second", status: "running" });
    const calls: string[] = [];
    const dispatcher = await createDispatcher([first, second], {
      cancelTask: async (taskId) => {
        calls.push(taskId);
        return task({
          ...(taskId === first.id ? first : second),
          status: "cancelled",
          signal: "SIGTERM",
        });
      },
    });

    const result = (await dispatcher.execute(toolCall("task_cancel"), {
      taskIds: [second.id, first.id, second.id],
    })) as { tasks: TaskRecord[] };

    assert.deepEqual(calls, [second.id, first.id]);
    assert.deepEqual(
      result.tasks.map((item) => item.id),
      [second.id, first.id],
    );
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
