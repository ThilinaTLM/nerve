import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { isAgentToolSuspension } from "@nervekit/host-runtime/harness";
import { SandboxStateStores } from "../src/state/sandbox-state.js";
import type { SandboxInteractionPort } from "../src/tools/sandbox-orchestration-types.js";
import { SandboxTaskService } from "../src/tools/sandbox-task-service.js";
import { SandboxToolRuntime } from "../src/tools/tool-runtime.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

function config() {
  return {
    version: 1,
    identity: { sandboxId: "sbx_contract" },
    agent: {
      defaultModel: { provider: "nerve-faux", model: "fast" },
      defaultPermissionLevel: "autonomous",
    },
    controller: {
      websocket: { url: "ws://manager.invalid/ws" },
      auth: { type: "api_key", apiKey: { env: "TOKEN" } },
    },
    tools: {
      groups: {
        input: { enabled: true },
        taskManagement: { enabled: true, maxTasks: 8 },
      },
    },
  } as never;
}

describe("sandbox shared tool host contract", () => {
  it("preserves the opaque provider tool-call id across ask-user suspension", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nerve-host-input-"));
    roots.push(root);
    let pendingToolCallId: string | undefined;
    const resolutionRef: { current?: Record<string, unknown> } = {};
    const interactions: SandboxInteractionPort = {
      setPending: (toolCallId) => {
        pendingToolCallId = toolCallId;
      },
      resolved: async () => resolutionRef.current,
    };
    const runtime = new SandboxToolRuntime(config(), {
      workspaceDir: process.cwd(),
      stateDir: root,
    });
    runtime.setInteractions(interactions);
    const scope = {
      conversationId: "conv_contract",
      agentId: "agent_main",
      runId: "run_contract",
      toolCallId: "provider-call-opaque",
    };

    await assert.rejects(
      runtime.execute("ask_user", { question: "Proceed?" }, scope),
      (error) => {
        assert.ok(isAgentToolSuspension(error));
        assert.equal(error.data.toolCallId, scope.toolCallId);
        assert.match(error.data.reason, /provider-call-opaque/);
        return true;
      },
    );
    assert.equal(pendingToolCallId, scope.toolCallId);
    resolutionRef.current = { text: "Proceed." };
    const result = await runtime.execute(
      "ask_user",
      { question: "Proceed?" },
      scope,
    );
    assert.equal(result.content, "Proceed.");
  });

  it("returns exact task payloads for single starts, selectors, and logs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nerve-host-task-"));
    roots.push(root);
    const stores = new SandboxStateStores(root);
    await stores.load();
    const notifyEvents: string[] = [];
    const unsubscribeNotify = stores.events.subscribeNotify((event) => {
      notifyEvents.push(event.type);
    });
    const taskService = new SandboxTaskService({
      stateDir: root,
      workspaceDir: process.cwd(),
      events: stores.events,
      maxTasks: 8,
    });
    await taskService.load();
    const runtime = new SandboxToolRuntime(config(), {
      workspaceDir: process.cwd(),
      stateDir: root,
      taskService,
    });
    const scope = {
      conversationId: "conv_tasks",
      agentId: "agent_main",
      runId: "run_tasks",
      toolCallId: "tool_batch",
    };
    const firstStart = await runtime.execute(
      "task_start",
      { name: "first", command: "printf 'first\\n'" },
      scope,
    );
    const secondStart = await runtime.execute(
      "task_start",
      { name: "second", command: "printf 'second\\n'" },
      { ...scope, toolCallId: "tool_second" },
    );
    const first = (firstStart.details as { task: { id: string } }).task;
    const second = (secondStart.details as { task: { id: string } }).task;
    assert.ok(first.id.startsWith("task_"));
    assert.ok(second.id.startsWith("task_"));

    const status = await runtime.execute(
      "task_status",
      { taskIds: [first.id, second.id] },
      { ...scope, toolCallId: "tool_status" },
    );
    assert.equal((status.details as { tasks: unknown[] }).tasks.length, 2);
    await taskService.drain();

    const logs = await runtime.execute(
      "task_logs",
      { taskId: first.id, mode: "recent" },
      { ...scope, toolCallId: "tool_logs" },
    );
    assert.match(logs.content ?? "", /first/);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const taskEvents = stores.events
      .all()
      .filter((event) => event.type.startsWith("task."));
    assert.equal(
      taskEvents.filter((event) => event.type === "task.created").length,
      2,
    );
    assert.equal(
      taskEvents.filter((event) => event.type === "task.started").length,
      2,
    );
    assert.ok(taskEvents.some((event) => event.type === "task.completed"));
    assert.ok(notifyEvents.includes("task.output"));
    assert.equal(
      taskEvents.some((event) => event.type === "task.output"),
      false,
    );
    unsubscribeNotify();
    await taskService.drain();
  });
});
