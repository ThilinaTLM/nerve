import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRecord } from "@nervekit/contracts/agents";
import {
  activeToolNamesForAgent,
  activeToolNamesForExploreAgent,
} from "../../../src/domains/tools/orchestration/agent-tool-adapter.js";

function agent(): AgentRecord {
  return {
    id: "agent_01HN0000000000000000000000",
    conversationId: "conv_01HN0000000000000000000000",
    projectId: "proj_01HN0000000000000000000000",
    projectDir: "/tmp/project",
    rootAgentId: "agent_01HN0000000000000000000000",
    mode: "coding",
    permissionLevel: "autonomous",
    workspaceScope: { roots: ["/tmp/project"] },
    budget: { depth: 0, maxDepth: 3 },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("explore availability", () => {
  it("uses configured capabilities rather than parentage or historical kind", () => {
    const root = activeToolNamesForAgent(agent());
    const child = activeToolNamesForAgent({
      ...agent(),
      executionKind: "async_developer",
      parentAgentId: agent().id,
    });
    const explore = activeToolNamesForExploreAgent();
    assert.ok(root.includes("task_start") && root.includes("task_status"));
    assert.ok(explore.includes("task_status") && explore.includes("task_logs"));
    assert.ok(child.includes("bash"));
    assert.ok(child.includes("task_start") && child.includes("ask_user"));
    const restricted = activeToolNamesForAgent({
      ...agent(),
      tools: ["read", "ask_user"],
    });
    assert.ok(restricted.includes("read") && restricted.includes("ask_user"));
    assert.ok(!restricted.includes("task_start"));
    const readonly = activeToolNamesForAgent({
      ...agent(),
      readOnlyCeiling: true,
      tools: ["read", "write", "bash", "ask_user"],
    });
    assert.ok(readonly.includes("read") && readonly.includes("ask_user"));
    assert.ok(!readonly.includes("write") && !readonly.includes("bash"));
    assert.throws(
      () => activeToolNamesForAgent({ ...agent(), tools: ["not_registered"] }),
      /unregistered tool/,
    );
  });

  it("is enabled by default and can be disabled", () => {
    const enabled = activeToolNamesForAgent(agent());
    const disabled = activeToolNamesForAgent(agent(), {
      disabledToolNames: ["explore"],
    });

    assert.equal(enabled.includes("explore"), true);
    assert.equal(disabled.includes("explore"), false);
  });
});
