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
          tasks: [outOfScope.id],
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

  it("accepts project-relative task cwd and rejects absolute or traversing cwd", async () => {
    let startInput: Record<string, unknown> | undefined;
    const dispatcher = await createDispatcher([], {
      startTask: async (input) => {
        startInput = input as Record<string, unknown>;
        return task({ id: "task_started", cwd: String(startInput.cwd) });
      },
    });

    await dispatcher.execute(toolCall("task_start"), {
      command: "pnpm dev",
      cwd: "packages/app",
      ready: { kind: "pattern", pattern: "ready", timeoutMs: 1_500 },
    });
    assert.equal(startInput?.cwd, "/tmp/project/packages/app");
    assert.equal(startInput?.readyPattern, "ready");
    assert.equal(startInput?.readyTimeoutMs, 1_500);
    assert.equal(startInput?.notify, true);
    await assert.rejects(
      dispatcher.execute(toolCall("task_start"), {
        command: "pnpm dev",
        cwd: "/tmp/project/packages/app",
      }),
      /relative to the project/,
    );
    await assert.rejects(
      dispatcher.execute(toolCall("task_start"), {
        command: "pnpm dev",
        cwd: "../other-project",
      }),
      /inside the project/,
    );
  });

  it("keeps sibling project directories in one task scope", async () => {
    const sibling = task({ cwd: "/tmp/project/packages/server" });
    const dispatcher = await createDispatcher([sibling]);
    const result = (await dispatcher.execute(
      { ...toolCall("task_status"), cwd: "/tmp/project/packages/app" },
      { tasks: [sibling.id] },
    )) as { tasks: TaskRecord[] };
    assert.equal(result.tasks[0]?.id, sibling.id);
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
    const dispatcher = await createDispatcher(
      [rootTask, nestedTask, siblingTask],
      { projectDir: "C:\\repo" },
    );

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
      id: "task_generation_one",
      name: "dev",
      restartedFromTaskId: "task_root",
      restartRootTaskId: "task_root",
      restartGeneration: 1,
      startedAt: "2026-01-02T03:04:06.000Z",
    });
    const dispatcher = await createDispatcher([rootTask, restarted]);

    const result = (await dispatcher.execute(toolCall("task_status"), {
      tasks: ["dev"],
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
      () => dispatcher.execute(toolCall("task_status"), { tasks: ["dev"] }),
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

  it("maps the compact task log cursor by mode", async () => {
    const running = task({ id: "task_running", status: "running" });
    const queries: TaskLogQuery[] = [];
    const dispatcher = await createDispatcher([running], {
      queryLogs: async (_taskId, query) => {
        queries.push(query);
        return {
          task: running,
          events: [],
          nextCursor: 0,
          hasMoreBefore: false,
          hasMoreAfter: false,
          mode: query.mode ?? "recent",
        };
      },
    });

    await dispatcher.execute(toolCall("task_logs"), {
      task: running.id,
      mode: "since_cursor",
      cursor: 7,
    });
    await dispatcher.execute(toolCall("task_logs"), {
      task: running.id,
      mode: "recent",
      cursor: 5,
    });
    assert.equal(queries[0]?.sinceSeq, 7);
    assert.equal(queries[0]?.beforeSeq, undefined);
    assert.equal(queries[1]?.beforeSeq, 5);
    assert.equal(queries[1]?.sinceSeq, undefined);
    await assert.rejects(
      dispatcher.execute(toolCall("task_logs"), {
        task: running.id,
        mode: "first_failure",
        cursor: 1,
      }),
      /does not accept cursor/,
    );
  });

  it("stops one selected task through task_control", async () => {
    const running = task({ id: "task_running", status: "running" });
    const calls: string[] = [];
    const dispatcher = await createDispatcher([running], {
      cancelTask: async (taskId) => {
        calls.push(taskId);
        return task({
          ...running,
          status: "cancelled",
          signal: "SIGTERM",
        });
      },
    });

    const result = (await dispatcher.execute(toolCall("task_control"), {
      task: running.id,
      action: "stop",
    })) as { action: string; task: TaskRecord };

    assert.deepEqual(calls, [running.id]);
    assert.equal(result.action, "stop");
    assert.equal(result.task.id, running.id);
    assert.equal(result.task.status, "cancelled");
  });

  it("restarts one selected task through task_control", async () => {
    const running = task({ id: "task_running", status: "running" });
    const dispatcher = await createDispatcher([running]);

    const result = (await dispatcher.execute(toolCall("task_control"), {
      task: running.id,
      action: "restart",
    })) as {
      action: string;
      task: TaskRecord;
      restartedFromTaskId: string;
    };

    assert.equal(result.action, "restart");
    assert.equal(result.task.id, "task_replacement");
    assert.equal(result.restartedFromTaskId, running.id);
  });

  it("bounds task_start peers while preserving their total", async () => {
    const peers = Array.from({ length: 22 }, (_, index) =>
      task({
        id: `task_peer_${index}`,
        status: "running",
        startedAt: new Date(Date.UTC(2026, 0, 2, 3, 4, index)).toISOString(),
      }),
    ).reverse();
    const dispatcher = await createDispatcher(peers, {
      startTask: async () => task({ id: "task_started", status: "running" }),
    });

    const result = (await dispatcher.execute(toolCall("task_start"), {
      command: "pnpm dev",
    })) as {
      otherActiveTasks: TaskRecord[];
      otherActiveTaskCount: number;
    };

    assert.equal(result.otherActiveTaskCount, 22);
    assert.equal(result.otherActiveTasks.length, 20);
    assert.equal(result.otherActiveTasks[0]?.id, "task_peer_21");
    assert.equal(result.otherActiveTasks[19]?.id, "task_peer_2");
  });

  it("returns other scoped active tasks after task_start", async () => {
    const peer = task({ id: "task_peer", status: "ready" });
    const terminal = task({ id: "task_terminal", status: "completed" });
    const outside = task({
      id: "task_outside",
      cwd: "/tmp/other-project",
      status: "running",
    });
    const dispatcher = await createDispatcher([peer, terminal, outside], {
      startTask: async () => task({ id: "task_started", status: "running" }),
    });

    const result = (await dispatcher.execute(toolCall("task_start"), {
      command: "pnpm dev",
    })) as {
      task: TaskRecord;
      otherActiveTasks: TaskRecord[];
      otherActiveTaskCount: number;
    };

    assert.equal(result.task.id, "task_started");
    assert.deepEqual(
      result.otherActiveTasks.map((item) => item.id),
      [peer.id],
    );
    assert.equal(result.otherActiveTaskCount, 1);
  });
});

async function createDispatcher(
  records: TaskRecord[],
  overrides: Partial<{
    restartTask: (taskId: string) => Promise<TaskRecord>;
    cancelTask: (taskId: string) => Promise<TaskRecord>;
    startTask: (input: unknown) => Promise<TaskRecord>;
    runForegroundBashWithPromotion: (input: unknown) => Promise<unknown>;
    queryLogs: (taskId: string, query: TaskLogQuery) => Promise<unknown>;
    settings: Settings;
    projectDir: string;
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
    queryLogs:
      overrides.queryLogs ??
      (async (taskId: string, query: TaskLogQuery = {}) => ({
        task: tasks.getTask(taskId),
        events: [],
        nextCursor: 0,
        mode: query.mode ?? "recent",
      })),
    restartTask:
      overrides.restartTask ??
      (async (taskId: string) => {
        const record = tasks.getTask(taskId);
        const restarted = task({
          ...record,
          id: "task_replacement",
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
    startTask: async (input: unknown) => {
      const started = overrides.startTask
        ? await overrides.startTask(input)
        : task({ id: "task_started", status: "running" });
      byId.set(started.id, started);
      return started;
    },
    getAgent: () => ({
      id: "agent_test",
      projectDir: overrides.projectDir ?? "/tmp/project",
      mode: "coding",
    }),
    runExplore: async () => ({ reports: [] }),
    getApiKey: async () => undefined,
    plans: {},
    setAgentMode: async () => ({
      id: "agent_test",
      projectDir: overrides.projectDir ?? "/tmp/project",
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
