import {
  defaultSettings,
  type Settings,
  type TaskLogQuery,
  type TaskRecord,
  type ToolCallRecord,
} from "@nervekit/contracts";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { OrchestrationToolDispatcher } from "../src/domains/tools/orchestration-tool-dispatcher.js";
import { CodedToolError } from "../src/domains/tools/tool-errors.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("orchestration task tools", () => {
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
    assert.equal(captured?.autoPromoteAfterMs, 120_000);
    assert.equal(captured?.projectId, "proj_test");
    assert.equal(captured?.conversationId, "conv_test");
    assert.equal(captured?.agentId, "agent_test");
    assert.equal(captured?.workerId, "worker_test");
  });

  it("resolves and validates a per-call Bash cwd before foreground execution", async () => {
    const base = await mkdtemp(join(tmpdir(), "nerve-bash-cwd-"));
    roots.push(base);
    const nested = join(base, "packages", "app");
    await mkdir(nested, { recursive: true });
    let captured: Record<string, unknown> | undefined;
    const dispatcher = await createDispatcher([], {
      runForegroundBashWithPromotion: async (input) => {
        captured = input as Record<string, unknown>;
        return {
          kind: "completed_foreground",
          result: { content: "ok", contentBlocks: [] },
        };
      },
    });
    const call = { ...toolCall("bash"), cwd: base };

    await dispatcher.execute(call, { command: "pwd", cwd: "packages/app" });
    assert.equal(captured?.cwd, nested);

    await dispatcher.execute(call, { command: "pwd", cwd: nested });
    assert.equal(captured?.cwd, nested);

    await assert.rejects(
      dispatcher.execute(call, { command: "pwd", cwd: "missing" }),
      /Tool argument 'cwd' does not exist/,
    );
    const file = join(base, "not-a-directory");
    await writeFile(file, "content", "utf8");
    await assert.rejects(
      dispatcher.execute(call, { command: "pwd", cwd: file }),
      /Tool argument 'cwd' is not a directory/,
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
});

async function createDispatcher(
  records: TaskRecord[],
  overrides: Partial<{
    restartTask: (taskId: string) => Promise<TaskRecord>;
    cancelTask: (taskId: string) => Promise<TaskRecord>;
    runForegroundBashWithPromotion: (input: unknown) => Promise<unknown>;
    settings: Settings;
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
    storage: {
      paths: { home: root },
      settings: overrides.settings ?? defaultSettings,
    },
    events: { publish: async () => undefined },
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
    conversationRuntime: {
      toolOutputOffset: () => 0,
      applyToolOutputDelta: (data: unknown) => data,
    },
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
