import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRecord } from "@nervekit/contracts/agents";
import { activeToolNamesForAgent } from "../../../src/domains/tools/orchestration/agent-tool-adapter.js";

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
    status: "idle",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("explore availability", () => {
  it("is enabled by default and can be disabled", () => {
    const enabled = activeToolNamesForAgent(agent());
    const disabled = activeToolNamesForAgent(agent(), {
      disabledToolNames: ["explore"],
    });

    assert.equal(enabled.includes("explore"), true);
    assert.equal(disabled.includes("explore"), false);
  });
});
