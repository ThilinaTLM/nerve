import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRecord, PermissionLevel } from "@nerve/shared";
import { evaluateToolPolicy } from "../src/policy.js";

function agent(
  permissionLevel: PermissionLevel,
  mode: AgentRecord["mode"] = "coding",
): AgentRecord {
  return {
    id: "agent_01HN0000000000000000000000",
    conversationId: "conv_01HN0000000000000000000000",
    projectId: "proj_01HN0000000000000000000000",
    projectDir: "/tmp/project",
    workerId: "worker_01HN0000000000000000000000",
    rootAgentId: "agent_01HN0000000000000000000000",
    mode,
    permissionLevel,
    workspaceScope: { roots: ["/tmp/project"] },
    budget: { depth: 0, maxDepth: 3, maxRuns: 8, usedRuns: 0 },
    status: "idle",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("tool policy", () => {
  it("classifies web tools as network with normal permission handling", () => {
    assert.equal(
      evaluateToolPolicy(
        agent("autonomous"),
        "web_search",
        { query: "docs" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "allow",
    );
    assert.equal(
      evaluateToolPolicy(
        agent("supervised"),
        "web_fetch",
        { url: "https://example.test" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "approval",
    );
    assert.equal(
      evaluateToolPolicy(
        agent("read_only"),
        "web_search",
        { query: "docs" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "deny",
    );
  });

  it("allows network research in planning mode with permission checks", () => {
    assert.equal(
      evaluateToolPolicy(
        agent("autonomous", "planning"),
        "web_search",
        { query: "current docs" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "allow",
    );
    assert.equal(
      evaluateToolPolicy(
        agent("supervised", "planning"),
        "web_fetch",
        { url: "https://example.test" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "approval",
    );
  });
});
