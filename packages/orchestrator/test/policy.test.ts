import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRecord, ToolName } from "@nerve/shared";
import { evaluateToolPolicy } from "../src/policy.js";

describe("tool policy", () => {
  it("allows Pi read-only tools for all permission levels", () => {
    for (const permissionLevel of [
      "read_only",
      "supervised",
      "autonomous",
    ] as AgentRecord["permissionLevel"][]) {
      for (const toolName of ["read", "grep", "find", "ls"] as ToolName[]) {
        const decision = evaluateToolPolicy(
          agent(permissionLevel),
          toolName,
          argsFor(toolName),
          { dataDir: "/tmp/nerve" },
        );
        assert.equal(
          decision.decision,
          "allow",
          `${permissionLevel}:${toolName}`,
        );
      }
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

  it("does not sandbox autonomous filesystem paths", () => {
    for (const [toolName, args] of [
      ["read", { path: "/tmp/outside.png" }],
      ["write", { path: "/tmp/outside.txt", content: "hello" }],
      [
        "edit",
        {
          path: "/tmp/outside.txt",
          edits: [{ oldText: "hello", newText: "goodbye" }],
        },
      ],
      ["grep", { pattern: "hello", path: "/tmp" }],
      ["find", { pattern: "*.png", path: "/tmp" }],
      ["ls", { path: "/tmp" }],
    ] as Array<[ToolName, Record<string, unknown>]>) {
      const decision = evaluateToolPolicy(agent("autonomous"), toolName, args, {
        dataDir: "/tmp/nerve",
      });
      assert.equal(decision.decision, "allow", toolName);
    }
  });

  it("allows autonomous commands without destructive or long-running gates", () => {
    for (const command of [
      "rm -rf /tmp/scratch",
      "git reset --hard HEAD",
      "pnpm dev",
      "npm run watch",
    ]) {
      const decision = evaluateToolPolicy(
        agent("autonomous"),
        "bash",
        { command },
        { dataDir: "/tmp/nerve" },
      );
      assert.equal(decision.decision, "allow", command);
    }
  });

  it("allows autonomous process mutation tools", () => {
    for (const toolName of ["process_stop", "process_restart"] as ToolName[]) {
      const decision = evaluateToolPolicy(
        agent("autonomous"),
        toolName,
        { processId: "proc_01HN0000000000000000000000" },
        { dataDir: "/tmp/nerve" },
      );
      assert.equal(decision.decision, "allow", toolName);
      assert.equal(decision.risk, "destructive");
    }
  });

  it("requires approval for supervised non-read tool calls", () => {
    for (const [toolName, args] of [
      ["bash", { command: "touch x" }],
      ["write", { path: "/tmp/outside.txt", content: "hello" }],
      ["process_start", { command: "pnpm dev" }],
      ["process_stop", { processId: "proc_01HN0000000000000000000000" }],
      ["subagent_run", { task: "Review the code" }],
    ] as Array<[ToolName, Record<string, unknown>]>) {
      const decision = evaluateToolPolicy(agent("supervised"), toolName, args, {
        dataDir: "/tmp/nerve",
      });
      assert.equal(decision.decision, "approval", toolName);
    }
  });

  it("denies read_only non-read tool calls", () => {
    for (const [toolName, args] of [
      ["bash", { command: "touch x" }],
      ["write", { path: "/tmp/outside.txt", content: "hello" }],
      ["process_start", { command: "pnpm dev" }],
      ["process_stop", { processId: "proc_01HN0000000000000000000000" }],
      ["subagent_run", { task: "Review the code" }],
    ] as Array<[ToolName, Record<string, unknown>]>) {
      const decision = evaluateToolPolicy(agent("read_only"), toolName, args, {
        dataDir: "/tmp/nerve",
      });
      assert.equal(decision.decision, "deny", toolName);
    }
  });

  it("still permits known read-only shell commands for read_only agents", () => {
    for (const command of ["pwd", "ls /tmp", "git diff -- README.md"]) {
      const decision = evaluateToolPolicy(
        agent("read_only"),
        "bash",
        { command },
        { dataDir: "/tmp/nerve" },
      );
      assert.equal(decision.decision, "allow", command);
      assert.equal(decision.risk, "read", command);
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
