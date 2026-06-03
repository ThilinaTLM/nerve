import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRecord, ToolName } from "@nerve/shared";
import { evaluateToolPolicy } from "../src/policy.js";

describe("tool policy", () => {
  it("allows Pi read-only tools for read_only agents", () => {
    for (const toolName of ["read", "grep", "find", "ls"] as ToolName[]) {
      const decision = evaluateToolPolicy(
        agent("read_only"),
        toolName,
        argsFor(toolName),
        {
          dataDir: "/tmp/nerve",
        },
      );
      assert.equal(decision.decision, "allow", toolName);
    }
  });

  it("allows ask_user for all permission levels and planning mode", () => {
    for (const permissionLevel of [
      "read_only",
      "supervised",
      "autonomous",
    ] as AgentRecord["permissionLevel"][]) {
      const decision = evaluateToolPolicy(
        { ...agent(permissionLevel), mode: "planning" },
        "ask_user",
        { question: "What should I optimize for?" },
        { dataDir: "/tmp/nerve" },
      );
      assert.equal(decision.decision, "allow", permissionLevel);
      assert.equal(decision.risk, "interaction");
    }
  });

  it("does not classify shell redirection or control operators as read-only", () => {
    for (const command of [
      "ls > out.txt",
      "pwd && touch x",
      "git diff | tee x",
    ]) {
      const decision = evaluateToolPolicy(
        agent("read_only"),
        "bash",
        { command },
        {
          dataDir: "/tmp/nerve",
        },
      );
      assert.equal(decision.decision, "deny", command);
    }
  });
});

function argsFor(toolName: ToolName): Record<string, unknown> {
  if (toolName === "grep") return { pattern: "x", path: "." };
  if (toolName === "find") return { pattern: "*.ts", path: "." };
  if (toolName === "ls") return { path: "." };
  return { path: "README.md" };
}

function agent(permissionLevel: AgentRecord["permissionLevel"]): AgentRecord {
  return {
    id: "agent_01HN0000000000000000000000",
    sessionId: "ses_01HN0000000000000000000000",
    projectId: "proj_01HN0000000000000000000000",
    projectDir: "/tmp/project",
    workerId: "worker_01HN0000000000000000000000",
    rootAgentId: "agent_01HN0000000000000000000000",
    mode: "coding",
    permissionLevel,
    workspaceScope: { roots: ["/tmp/project"] },
    budget: { depth: 0, maxDepth: 3, maxRuns: 8, usedRuns: 0 },
    status: "idle",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
