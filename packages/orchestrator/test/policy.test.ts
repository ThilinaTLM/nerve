import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRecord, PermissionLevel } from "@nerve/shared";
import { evaluateToolPolicy } from "../src/domains/tools/policy.js";

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

  it("handles python as a command tool with planning-mode guardrails", () => {
    assert.equal(
      evaluateToolPolicy(
        agent("autonomous"),
        "python",
        { code: "print('ok')" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "allow",
    );
    assert.equal(
      evaluateToolPolicy(
        agent("supervised"),
        "python",
        { code: "print('ok')" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "approval",
    );
    assert.equal(
      evaluateToolPolicy(
        agent("read_only"),
        "python",
        { code: "print('ok')" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "deny",
    );
    const planning = evaluateToolPolicy(
      agent("autonomous", "planning"),
      "python",
      { code: "print('ok')" },
      { dataDir: "/tmp/nerve" },
    );
    assert.equal(planning.decision, "allow");
    assert.match(planning.reason, /file-write guardrails/);
    assert.equal(
      evaluateToolPolicy(
        agent("supervised", "planning"),
        "python",
        { code: "print('ok')" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "approval",
    );
  });

  it("applies planning-mode plan-file guardrails to smart_edit", () => {
    const allowed = evaluateToolPolicy(
      agent("autonomous", "planning"),
      "smart_edit",
      {
        path: "/tmp/nerve/plans/smart-edit-plan.md",
        operations: [
          { type: "insert_lines", line: 1, position: "after", text: "ok" },
        ],
      },
      { dataDir: "/tmp/nerve" },
    );
    assert.equal(allowed.decision, "allow");
    assert.equal(
      allowed.normalizedArgs.path,
      "/tmp/nerve/plans/smart-edit-plan.md",
    );

    const denied = evaluateToolPolicy(
      agent("autonomous", "planning"),
      "smart_edit",
      {
        path: "src/app.ts",
        operations: [
          { type: "insert_lines", line: 1, position: "after", text: "ok" },
        ],
      },
      { dataDir: "/tmp/nerve" },
    );
    assert.equal(denied.decision, "deny");
    assert.match(denied.reason, /Planning mode allows smart_edit only/);

    assert.equal(
      evaluateToolPolicy(
        agent("supervised", "planning"),
        "smart_edit",
        {
          path: "/tmp/nerve/plans/smart-edit-plan.md",
          operations: [
            { type: "insert_lines", line: 1, position: "after", text: "ok" },
          ],
        },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "approval",
    );
  });

  it("handles explore as a bounded agent-spawn tool", () => {
    assert.equal(
      evaluateToolPolicy(
        agent("autonomous"),
        "explore",
        { task: "map the API" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "allow",
    );
    assert.equal(
      evaluateToolPolicy(
        agent("supervised"),
        "explore",
        { task: "map the API" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "approval",
    );
    assert.equal(
      evaluateToolPolicy(
        agent("read_only"),
        "explore",
        { task: "map the API" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "deny",
    );
    assert.equal(
      evaluateToolPolicy(
        agent("autonomous", "planning"),
        "explore",
        { task: "map the API" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "allow",
    );
  });

  it("uses a blacklist guard for planning-mode bash commands", () => {
    const autonomousSafe = evaluateToolPolicy(
      agent("autonomous", "planning"),
      "bash",
      { command: "pnpm check" },
      { dataDir: "/tmp/nerve" },
    );
    assert.equal(autonomousSafe.decision, "allow");
    assert.equal(autonomousSafe.risk, "command");
    assert.match(autonomousSafe.reason, /blacklist guard/);

    const supervisedSafe = evaluateToolPolicy(
      agent("supervised", "planning"),
      "bash",
      { command: "biome check . && tsc --noEmit" },
      { dataDir: "/tmp/nerve" },
    );
    assert.equal(supervisedSafe.decision, "approval");
    assert.equal(supervisedSafe.risk, "command");

    assert.equal(
      evaluateToolPolicy(
        agent("read_only", "planning"),
        "bash",
        { command: "pnpm check" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "deny",
    );

    const supervisedReadOnlyCommand = evaluateToolPolicy(
      agent("supervised", "planning"),
      "bash",
      { command: "git status --short" },
      { dataDir: "/tmp/nerve" },
    );
    assert.equal(supervisedReadOnlyCommand.decision, "allow");
    assert.equal(supervisedReadOnlyCommand.risk, "read");

    for (const command of [
      "find . -delete",
      "rm -rf dist",
      "pnpm install",
      "pnpm run dev",
      "echo hello > file.txt",
    ]) {
      assert.equal(
        evaluateToolPolicy(
          agent("autonomous", "planning"),
          "bash",
          { command },
          { dataDir: "/tmp/nerve" },
        ).decision,
        "deny",
        command,
      );
    }
  });
});
