import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { RunManager } from "../src/agent/run-manager.js";
import { RunStateStore } from "../src/agent/run-state-store.js";
import { SandboxStateStores } from "../src/state/sandbox-state.js";
import { TaskSupervisor } from "../src/tools/task-supervisor.js";
import { SandboxToolRuntime } from "../src/tools/tool-runtime.js";

function config() {
  return {
    version: 1,
    identity: { sandboxId: "sbx_tools" },
    agent: {
      mainModel: { provider: "nerve-faux", model: "fast" },
    },
    controller: {
      websocket: { url: "ws://manager.invalid/ws" },
      auth: { type: "api_key", apiKey: { env: "TOKEN" } },
    },
    tools: { groups: { taskManagement: { enabled: true, maxTasks: 4 } } },
  } as const;
}

describe("tool lifecycle cancellation", () => {
  it("cancels supervised tasks for a run and emits durable cancelled tool records", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-tool-cancel-"));
    try {
      const stores = new SandboxStateStores(dir);
      await stores.load();
      const manager = new RunManager(
        new RunStateStore(dir),
        dir,
        stores.events,
      );
      const supervisor = new TaskSupervisor({ stateDir: dir, maxTasks: 4 });
      await supervisor.load();
      const runtime = new SandboxToolRuntime(config(), {
        workspaceDir: process.cwd(),
        stateDir: dir,
        taskSupervisor: supervisor,
        toolCallStore: manager.toolCallStore(),
        events: stores.events,
      });
      const scope = {
        conversationId: "conv_task",
        agentId: "agent_main",
        runId: "run_task",
      };
      const result = await runtime.execute(
        "task_start",
        { command: "sleep 30", name: "slow" },
        { ...scope, toolCallId: "task_tool_1" },
      );
      const task = (result.details as { task: { id: string } }).task;
      assert.equal(supervisor.get(task.id)?.status, "running");

      await runtime.cancelRun(scope);
      assert.equal(supervisor.get(task.id)?.status, "cancelled");

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
      assert.match(toolJsonl, /"toolCallId":"task_tool_1"/);
      assert.ok(
        stores.events
          .all()
          .some(
            (event) =>
              event.type === "tool.call.cancelled" &&
              event.runId === scope.runId &&
              (event.data as { toolCallId?: string }).toolCallId ===
                "task_tool_1",
          ),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
