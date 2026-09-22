import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRecord } from "@nervekit/contracts/agents";
import { activeToolNamesForAgent } from "../../../src/domains/tools/orchestration/agent-tool-adapter.js";

const agent: AgentRecord = {
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

function active(options: { available?: boolean; disabled?: boolean }) {
  return activeToolNamesForAgent(agent, {
    pythonAvailable: true,
    jiraEnabled: true,
    confluenceEnabled: true,
    imageGenerationAvailable: options.available,
    disabledToolNames: options.disabled ? ["generate_image"] : [],
  });
}

describe("generate_image availability", () => {
  it("requires the selected provider to be ready and the tool enabled", () => {
    assert.equal(active({ available: true }).includes("generate_image"), true);
    assert.equal(
      active({ available: false }).includes("generate_image"),
      false,
    );
    assert.equal(
      active({ available: true, disabled: true }).includes("generate_image"),
      false,
    );
  });
});
