import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRecord } from "@nervekit/shared";
import { exploreProgressFromHarnessEvent } from "../src/domains/agents/run/explore-helpers.js";
import type { SubagentRunSpec } from "../src/domains/agents/run/subagent-runner.js";

const child: AgentRecord = {
  id: "agent_01H00000000000000000000000",
  conversationId: "conv_01H00000000000000000000000",
  projectId: "proj_01H00000000000000000000000",
  projectDir: "/tmp/project",
  rootAgentId: "agent_01H00000000000000000000000",
  mode: "coding",
  permissionLevel: "read_only",
  workspaceScope: { roots: ["/tmp/project"] },
  budget: { depth: 1, maxDepth: 3, maxRuns: 8, usedRuns: 0 },
  model: { provider: "provider", modelId: "model" },
  thinkingLevel: "off",
  status: "running",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const spec = {
  taskIndex: 1,
  taskCount: 3,
  label: "api",
} as SubagentRunSpec;

function toolCallMessage(
  toolName: string,
  args: Record<string, unknown>,
): string {
  const update = exploreProgressFromHarnessEvent(
    { type: "tool_execution_start", toolName, args },
    child,
    spec,
  );
  assert.ok(update);
  assert.equal(update.phase, "tool_call");
  assert.equal(update.taskIndex, 1);
  assert.equal(update.taskCount, 3);
  assert.equal(update.label, "api");
  assert.equal(update.model, "provider/model");
  assert.equal(update.thinkingLevel, "off");
  return update.message;
}

describe("explore progress formatting", () => {
  it("formats read/search/list tool calls as concise one-liners", () => {
    assert.equal(
      toolCallMessage("read", {
        path: "src/app/server.ts",
        offset: 10,
        limit: 5,
      }),
      "read src/app/server.ts (10+5)",
    );
    assert.equal(
      toolCallMessage("grep", { pattern: "auth", path: "src" }),
      'grep "auth" in src',
    );
    assert.equal(
      toolCallMessage("find", { pattern: "*.ts" }),
      'find "*.ts" in .',
    );
    assert.equal(toolCallMessage("ls", { path: "src" }), "ls src");
  });

  it("formats task tool calls as concise one-liners", () => {
    assert.equal(
      toolCallMessage("task_status", { taskIds: ["dev", "test"] }),
      "task_status 2 tasks",
    );
    assert.equal(
      toolCallMessage("task_logs", {
        groupId: "taskgrp_01H00000000000000000000000",
        mode: "errors",
      }),
      "task_logs group taskgrp_01H00000000000000000000000 (errors)",
    );
    assert.equal(
      toolCallMessage("task_list", {
        activeOnly: true,
        projectId: "proj_01H00000000000000000000000",
        agentId: "agent_02H00000000000000000000000",
      }),
      "task_list active · project proj_01H00000000000000000000000 · agent agent_02H00000000000000000000000",
    );
  });

  it("formats tool execution results without relying on hidden child tool-call records", () => {
    const update = exploreProgressFromHarnessEvent(
      {
        type: "tool_execution_end",
        toolName: "grep",
        result: {
          content: [{ type: "text", text: "grep output" }],
          details: {},
        },
        isError: false,
      },
      child,
      spec,
    );
    assert.ok(update);
    assert.equal(update.phase, "tool_result");
    assert.equal(update.message, "grep completed");
  });

  it("formats failed tool execution results with the first text block", () => {
    const update = exploreProgressFromHarnessEvent(
      {
        type: "tool_execution_end",
        toolName: "read",
        result: {
          content: [{ type: "text", text: "path not found" }],
          details: {},
        },
        isError: true,
      },
      child,
      spec,
    );
    assert.ok(update);
    assert.equal(update.phase, "tool_result");
    assert.equal(update.message, "read failed: path not found");
  });

  it("suppresses assistant starts so Thinking noise cannot dominate progress", () => {
    const update = exploreProgressFromHarnessEvent(
      { type: "message_start", message: { role: "assistant" } },
      child,
      spec,
    );
    assert.equal(update, undefined);
  });
});
