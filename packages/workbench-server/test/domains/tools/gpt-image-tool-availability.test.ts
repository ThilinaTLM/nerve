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
    gptImageAvailable: options.available,
    disabledToolNames: options.disabled ? ["gpt_image"] : [],
  });
}

describe("gpt_image availability", () => {
  it("requires an enabled OpenAI Codex OAuth capability", () => {
    assert.equal(active({ available: true }).includes("gpt_image"), true);
    assert.equal(active({ available: false }).includes("gpt_image"), false);
    assert.equal(
      active({ available: true, disabled: true }).includes("gpt_image"),
      false,
    );
  });
});
