import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import type {
  AgentRecord,
  PermissionException,
  PermissionLevel,
  LegacyPermissionRule,
} from "@nervekit/contracts";
import {
  builtInPermissionRuleSet,
  composeEffectivePermissionPolicy,
} from "@nervekit/tools";
import { evaluateWorkbenchToolPermission } from "../../../src/domains/tools/permission/index.js";

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
const roots = {
  project: "/workspace",
  nerve_home: "/home/test/.nerve",
  nerve_data: "/home/test/.nerve/data",
  plans: "/home/test/.nerve/data/plans",
};

function ruleSetContext(id: "supervised" | "autonomous") {
  return {
    ...context,
    roots,
    policy: composeEffectivePermissionPolicy({
      selectedRuleSet: builtInPermissionRuleSet(id),
    }),
  };
}

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

  it("allows filesystem tools to target paths outside the project", () => {
    assert.equal(
      evaluateWorkbenchToolPermission(
        agent("supervised"),
        "read",
        { path: "/tmp/outside.txt" },
        context,
      ).decision,
      "allow",
    );
    assert.equal(
      evaluateWorkbenchToolPermission(
        agent("autonomous"),
        "write",
        { path: "/tmp/outside.txt", content: "x" },
        context,
      ).decision,
      "allow",
    );
  });

  it("projects external targets through the permission rule-set evaluator", () => {
    const read = evaluateWorkbenchToolPermission(
      agent("supervised"),
      "read",
      { path: "/tmp/outside.txt" },
      ruleSetContext("supervised"),
    );
    assert.equal(read.decision, "allow");
    assert.deepEqual(read.permissionEvaluation?.normalizedTargets, [
      {
        kind: "path",
        access: "read",
        scope: "exact",
        absolutePath: "/tmp/outside.txt",
      },
    ]);
    assert.deepEqual(read.supervision?.normalizedTargets, [
      {
        kind: "path",
        access: "read",
        scope: "exact",
        absolutePath: "/tmp/outside.txt",
      },
    ]);

    const supervisedWrite = evaluateWorkbenchToolPermission(
      agent("supervised"),
      "write",
      { path: "/tmp/outside.txt", content: "x" },
      ruleSetContext("supervised"),
    );
    assert.equal(supervisedWrite.decision, "approval");

    const autonomousWrite = evaluateWorkbenchToolPermission(
      agent("autonomous"),
      "write",
      { path: "/tmp/outside.txt", content: "x" },
      ruleSetContext("autonomous"),
    );
    assert.equal(autonomousWrite.decision, "allow");
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

  it("allows plan writes and edits only inside the plan or system temporary directories", () => {
    const planPath = join(context.dataDir, "data", "plans", "example.md");
    const insidePlanDir = evaluateWorkbenchToolPermission(
      agent("supervised", "planning"),
      "write",
      { path: planPath, content: "# Plan" },
      context,
    );
    assert.equal(insidePlanDir.decision, "allow");
    assert.equal(insidePlanDir.normalizedArgs.path, resolve(planPath));

    const temporaryPath = join(tmpdir(), "nerve-plan-mode", "notes.md");
    const insideTemporaryDir = evaluateWorkbenchToolPermission(
      agent("autonomous", "planning"),
      "edit",
      {
        path: temporaryPath,
        edits: [{ oldText: "old", newText: "new" }],
      },
      context,
    );
    assert.equal(insideTemporaryDir.decision, "allow");
    assert.equal(
      insideTemporaryDir.normalizedArgs.path,
      resolve(temporaryPath),
    );
    assert.equal(
      evaluateWorkbenchToolPermission(
        agent("supervised", "planning"),
        "write",
        { path: temporaryPath, content: "notes" },
        context,
      ).decision,
      "approval",
    );

    const outsidePath = resolve(
      tmpdir(),
      "..",
      "nerve-outside-system-temp",
      "notes.md",
    );
    const outside = evaluateWorkbenchToolPermission(
      agent("autonomous", "planning"),
      "write",
      { path: outsidePath, content: "x" },
      context,
    );
    assert.equal(outside.decision, "deny");
    assert.match(outside.reason, /system temporary directory/);
  });

  it("keeps explicit plan-write denials stronger than planning auto-allow", () => {
    const planPath = join(context.dataDir, "data", "plans", "blocked.md");
    const rule: LegacyPermissionRule = {
      id: "rule_block_plan_write",
      scope: "project",
      projectId: "proj_test",
      effect: "deny",
      toolName: "write",
      matcherKind: "whole_tool",
      pattern: "*",
      enabled: true,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    const result = evaluateWorkbenchToolPermission(
      agent("supervised", "planning"),
      "write",
      { path: planPath, content: "# Blocked" },
      { ...context, rules: [rule] },
    );
    assert.equal(result.decision, "deny");
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
