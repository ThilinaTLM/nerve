import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { isAgentToolSuspension } from "@nervekit/host-runtime/harness";
import { SandboxStateStores } from "../src/state/sandbox-state.js";
import { InputWaiter } from "../src/tools/input-waiter.js";
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
    const inputWaiter = new InputWaiter(root);
    await inputWaiter.load();
    const runtime = new SandboxToolRuntime(config(), {
      workspaceDir: process.cwd(),
      stateDir: root,
      inputWaiter,
    });
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
    const wait = inputWaiter.get(scope.toolCallId);
    assert.equal(wait?.requestId, scope.toolCallId);
    await inputWaiter.submit({
      requestId: scope.toolCallId,
      ...scope,
      text: "Proceed.",
    });
    const result = await runtime.execute(
      "ask_user",
      { question: "Proceed?" },
      scope,
    );
    assert.equal(result.content, "Proceed.");
  });

  it("returns normalized task records for batches, groups, selectors, and logs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nerve-host-task-"));
    roots.push(root);
    const stores = new SandboxStateStores(root);
    await stores.load();
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
    const started = await runtime.execute(
      "task_start",
      {
        name: "contract batch",
        tasks: [
          { name: "first", command: "printf 'first\\n'" },
          { name: "second", command: "printf 'second\\n'" },
        ],
      },
      scope,
    );
    const details = started.details as {
      groupId: string;
      tasks: Array<{ id: string; groupId?: string; status: string }>;
    };
    assert.match(details.groupId, /^taskgrp_/);
    assert.equal(details.tasks.length, 2);
    assert.ok(details.tasks.every((task) => task.groupId === details.groupId));

    const status = await runtime.execute(
      "task_status",
      { groupId: details.groupId },
      { ...scope, toolCallId: "tool_status" },
    );
    assert.equal((status.details as { tasks: unknown[] }).tasks.length, 2);
    await taskService.drain();

    const logs = await runtime.execute(
      "task_logs",
      { taskId: details.tasks[0]?.id, mode: "recent" },
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
    assert.ok(
      taskEvents.some(
        (event) =>
          event.type === "task.output" && event.durability === "transient",
      ),
    );
  });
});
