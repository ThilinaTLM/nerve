import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { RunManager } from "../src/agent/run-manager.js";
import { RunStateStore } from "../src/agent/run-state-store.js";
import { SandboxStateStores } from "../src/state/sandbox-state.js";
import { SandboxTaskService } from "../src/tools/sandbox-task-service.js";
import { SandboxToolRuntime } from "../src/tools/tool-runtime.js";

function config() {
  return {
    version: 1,
    identity: { sandboxId: "sbx_tools" },
    agent: {
      defaultModel: { provider: "nerve-faux", model: "fast" },
    },
    controller: {
      websocket: { url: "ws://manager.invalid/ws" },
      auth: { type: "api_key", apiKey: { env: "TOKEN" } },
    },
    tools: { groups: { taskManagement: { enabled: true, maxTasks: 4 } } },
  } as const;
}

async function waitForTaskStatus(
  taskService: SandboxTaskService,
  id: string,
  status: "running" | "completed" | "failed" | "cancelled" | "orphaned",
): Promise<void> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if ((await taskService.get(id))?.status === status) return;
    await delay(10);
  }
  assert.fail(`task ${id} did not reach status ${status}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("tool lifecycle cancellation", () => {
  it("projects lifecycle rows without dropping args or result", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-tool-project-"));
    try {
      const manager = new RunManager(new RunStateStore(dir), dir);
      const store = manager.toolCallStore();
      const scope = {
        conversationId: "conv_project",
        agentId: "agent_main",
        runId: "run_project",
      };

      await store.append(scope, {
        toolCallId: "call_project",
        toolName: "bash",
        status: "requested",
        displayArgs: { command: "echo projected" },
        args: { hash: "sha256:args" },
        lifecycleSeq: 1,
        redactionVersion: 1,
        requestedAt: "2026-07-07T00:00:00.000Z",
      });
      await store.append(scope, {
        toolCallId: "call_project",
        toolName: "bash",
        status: "started",
        displayArgs: { command: "echo projected" },
        args: { hash: "sha256:args" },
        lifecycleSeq: 2,
        redactionVersion: 1,
        requestedAt: "2026-07-07T00:00:01.000Z",
        startedAt: "2026-07-07T00:00:01.000Z",
      });
      await store.append(scope, {
        toolCallId: "call_project",
        toolName: "bash",
        status: "completed",
        lifecycleSeq: 3,
        redactionVersion: 1,
        requestedAt: "2026-07-07T00:00:02.000Z",
        completedAt: "2026-07-07T00:00:02.000Z",
        result: { content: "projected\n", exitCode: 0 },
      });

      const projected = (await store.latestByToolCallId(scope)).get(
        "call_project",
      );
      assert.equal(projected?.status, "completed");
      assert.equal(projected?.requestedAt, "2026-07-07T00:00:00.000Z");
      assert.equal(projected?.startedAt, "2026-07-07T00:00:01.000Z");
      assert.deepEqual(projected?.displayArgs, { command: "echo projected" });
      assert.deepEqual(projected?.args, { hash: "sha256:args" });
      assert.deepEqual(projected?.result, {
        content: "projected\n",
        exitCode: 0,
      });
      assert.equal(projected?.lifecycleSeq, 3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps spawn error task finalization when close also fires", async () => {
    const dir = await mkdtemp(
      path.join(os.tmpdir(), "nerve-task-spawn-error-"),
    );
    let taskService: SandboxTaskService | undefined;
    try {
      const stores = new SandboxStateStores(dir);
      await stores.load();
      taskService = new SandboxTaskService({
        stateDir: dir,
        workspaceDir: dir,
        events: stores.events,
        maxTasks: 1,
      });
      const task = await taskService.start({
        command: "true",
        cwd: path.join(dir, "missing-cwd"),
      });

      await waitForTaskStatus(taskService, task.id, "failed");
      await delay(50);
      await taskService.drain();

      const finalTask = await taskService.get(task.id);
      assert.equal(finalTask?.status, "failed");
      assert.equal(finalTask?.exitCode, 127);
      const logs = await taskService.logs(task.id, {});
      assert.match(
        logs.events.map((event) => event.line).join("\n"),
        /ENOENT|no such file/i,
      );
    } finally {
      await taskService?.drain().catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("cancels supervised tasks for a run and persists cancelled tool records", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-tool-cancel-"));
    let taskService: SandboxTaskService | undefined;
    try {
      const stores = new SandboxStateStores(dir);
      await stores.load();
      const manager = new RunManager(
        new RunStateStore(dir),
        dir,
        stores.events,
      );
      taskService = new SandboxTaskService({
        stateDir: dir,
        workspaceDir: process.cwd(),
        events: stores.events,
        maxTasks: 4,
      });
      await taskService.load();
      const runtime = new SandboxToolRuntime(config(), {
        workspaceDir: process.cwd(),
        stateDir: dir,
        taskService,
        toolCallStore: manager.toolCallStore(),
      });
      const scope = {
        conversationId: "conv_task",
        agentId: "agent_main",
        runId: "run_task",
      };
      const result = await runtime.execute(
        "task_start",
        { command: "sleep 30", name: "slow" },
        { ...scope, toolCallId: "tool_task_1" },
      );
      const task = (result.details as { task: { id: string } }).task;
      assert.equal((await taskService.get(task.id))?.status, "running");

      await runtime.cancelRun(scope);
      assert.equal((await taskService.get(task.id))?.status, "cancelled");

      const toolFile = path.join(
        dir,
        "conversations",
        scope.conversationId,
        "agents",
        scope.agentId,
        "runs",
        scope.runId,
        "tools",
        "tool-calls.jsonl",
      );
      const toolJsonl = await readFile(toolFile, "utf8");
      assert.match(toolJsonl, /"status":"cancelled"/);
      assert.match(toolJsonl, /"toolCallId":"tool_task_1"/);
      await taskService.drain();
    } finally {
      await taskService?.drain().catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
