import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AgentRecord,
  PermissionException,
  PermissionLevel,
} from "@nervekit/contracts";
import { evaluateWorkbenchToolPermission } from "../src/domains/tools/permission/index.js";

function agent(
  permissionLevel: PermissionLevel,
  mode: "coding" | "planning" = "coding",
): AgentRecord {
  return {
    id: "agent_test",
    conversationId: "conv_test",
    projectId: "proj_test",
    projectDir: "/workspace",
    rootAgentId: "agent_test",
    mode,
    permissionLevel,
    workspaceScope: { roots: ["/workspace"] },
    budget: { depth: 0, maxDepth: 3 },
    thinkingLevel: "off",
    status: "idle",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

const context = { dataDir: "/home/test/.nerve" };

describe("Workbench tool permission", () => {
  it("delegates coding decisions to the canonical evaluator", () => {
    assert.equal(
      evaluateWorkbenchToolPermission(
        agent("supervised"),
        "read",
        { path: "README.md" },
        context,
      ).decision,
      "allow",
    );
    assert.equal(
      evaluateWorkbenchToolPermission(
        agent("supervised"),
        "write",
        { path: "README.md", content: "x" },
        context,
      ).decision,
      "approval",
    );
    assert.equal(
      evaluateWorkbenchToolPermission(
        agent("read_only"),
        "web_fetch",
        { url: "https://example.com" },
        context,
      ).decision,
      "deny",
    );
  });

  it("keeps plan-only tools unavailable in coding mode", () => {
    const result = evaluateWorkbenchToolPermission(
      agent("autonomous"),
      "plan_mode_present",
      { path: "/tmp/plan.md" },
      context,
    );
    assert.equal(result.decision, "deny");
  });

  it("allows planning reads and denies mutating Bash before permission evaluation", () => {
    assert.equal(
      evaluateWorkbenchToolPermission(
        agent("supervised", "planning"),
        "bash",
        { command: "git status --short" },
        context,
      ).decision,
      "allow",
    );
    const denied = evaluateWorkbenchToolPermission(
      agent("autonomous", "planning"),
      "bash",
      { command: "rm -rf dist" },
      context,
    );
    assert.equal(denied.decision, "deny");
    assert.match(denied.reason, /Planning mode blocks bash/);
  });

  it("allows plan writes only inside the host plan directory", () => {
    const inside = evaluateWorkbenchToolPermission(
      agent("supervised", "planning"),
      "write",
      { path: "/home/test/.nerve/plans/example.md", content: "# Plan" },
      context,
    );
    assert.equal(inside.decision, "approval");
    assert.equal(
      inside.normalizedArgs.path,
      "/home/test/.nerve/plans/example.md",
    );
    const outside = evaluateWorkbenchToolPermission(
      agent("autonomous", "planning"),
      "write",
      { path: "/workspace/plan.md", content: "x" },
      context,
    );
    assert.equal(outside.decision, "deny");
  });

  it("cannot override planning denials with an exception", () => {
    const exception: PermissionException = {
      id: "exception_write",
      tool: "write",
      effect: "allow",
      rule: "**",
    };
    const result = evaluateWorkbenchToolPermission(
      agent("supervised", "planning"),
      "write",
      { path: "/workspace/a", content: "x" },
      { ...context, exceptions: [exception] },
    );
    assert.equal(result.decision, "deny");
  });

  it("does not offer durable Python exceptions", () => {
    const result = evaluateWorkbenchToolPermission(
      agent("supervised"),
      "python_exec",
      { code: "print(1)" },
      context,
    );
    assert.equal(result.decision, "approval");
    assert.deepEqual(result.suggestedExceptions, []);
  });
});
