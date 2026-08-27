import assert from "node:assert/strict";
import test from "node:test";
import type { PermissionRule } from "@nervekit/contracts";
import { evaluateToolSupervision } from "../src/policy/evaluate-tool-supervision.js";

const timestamp = "2026-08-24T00:00:00.000Z";

function rule(
  input: Partial<PermissionRule> & Pick<PermissionRule, "id">,
): PermissionRule {
  return {
    id: input.id,
    scope: input.scope ?? "user",
    projectId: input.projectId,
    effect: input.effect ?? "allow",
    toolName: input.toolName ?? "web_fetch",
    matcherKind: input.matcherKind ?? "url_glob",
    pattern: input.pattern ?? "*",
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function evaluate(rules: PermissionRule[]) {
  return evaluateToolSupervision({
    toolName: "web_fetch",
    args: { url: "https://evil.example/path" },
    mode: "coding",
    permissionLevel: "autonomous",
    projectId: "proj_test",
    projectDir: "/workspace",
    cwd: "/workspace",
    rules,
    evaluatedAt: timestamp,
  });
}

test("filesystem tools may target paths outside the project", () => {
  const requests = [
    { toolName: "read", args: { path: "/tmp/outside.txt" } },
    { toolName: "grep", args: { pattern: "needle", path: "/tmp" } },
    { toolName: "find", args: { pattern: "*.txt", path: "/tmp" } },
    { toolName: "ls", args: { path: "/tmp" } },
    {
      toolName: "edit",
      args: {
        path: "/tmp/outside.txt",
        edits: [{ oldText: "old", newText: "new" }],
      },
    },
    { toolName: "write", args: { path: "/tmp/outside.txt", content: "x" } },
  ] as const;

  for (const request of requests) {
    const decision = evaluateToolSupervision({
      ...request,
      mode: "coding",
      permissionLevel: "autonomous",
      projectId: "proj_test",
      projectDir: "/workspace",
      cwd: "/workspace",
      rules: [],
      evaluatedAt: timestamp,
    });
    assert.equal(decision.decision, "allow", request.toolName);
  }
});

test("external paths retain normal supervised read and write behavior", () => {
  const common = {
    mode: "coding" as const,
    permissionLevel: "supervised" as const,
    projectId: "proj_test",
    projectDir: "/workspace",
    cwd: "/workspace",
    rules: [],
    evaluatedAt: timestamp,
  };
  assert.equal(
    evaluateToolSupervision({
      ...common,
      toolName: "read",
      args: { path: "/tmp/outside.txt" },
    }).decision,
    "allow",
  );
  assert.equal(
    evaluateToolSupervision({
      ...common,
      toolName: "write",
      args: { path: "/tmp/outside.txt", content: "x" },
    }).decision,
    "prompt",
  );
});

test("unsupported bash syntax follows the configured permission level", () => {
  const common = {
    toolName: "bash" as const,
    args: { command: 'gh pr create --body "$(cat file)"' },
    mode: "coding" as const,
    projectId: "proj_test",
    projectDir: "/workspace",
    cwd: "/workspace",
    rules: [],
    evaluatedAt: timestamp,
  };

  const supervised = evaluateToolSupervision({
    ...common,
    permissionLevel: "supervised",
  });
  assert.equal(supervised.decision, "prompt");
  assert.equal(supervised.effectiveRisk, "command");
  assert.deepEqual(supervised.normalizedTargets, []);
  assert.deepEqual(supervised.suggestedRules, []);

  const autonomous = evaluateToolSupervision({
    ...common,
    permissionLevel: "autonomous",
  });
  assert.equal(autonomous.decision, "allow");
  assert.equal(autonomous.effectiveRisk, "command");
  assert.deepEqual(autonomous.normalizedTargets, []);
});

test("malformed non-bash targets remain denied", () => {
  const decision = evaluateToolSupervision({
    toolName: "web_fetch",
    args: { url: "not a url" },
    mode: "coding",
    permissionLevel: "autonomous",
    projectId: "proj_test",
    projectDir: "/workspace",
    cwd: "/workspace",
    rules: [],
    evaluatedAt: timestamp,
  });

  assert.equal(decision.decision, "deny");
  assert.equal(decision.reason, "Tool targets are missing or malformed.");
});

test("supervision applies covering deny rules before allows", () => {
  const decision = evaluate([
    rule({ id: "rule_allow", pattern: "https://evil.example/*" }),
    rule({
      id: "rule_deny",
      scope: "project",
      projectId: "proj_test",
      effect: "deny",
      pattern: "https://evil.example/*",
    }),
  ]);
  assert.equal(decision.decision, "deny");
  assert.deepEqual(decision.matchedRuleIds, ["rule_allow", "rule_deny"]);
});

test("policy snapshot hashes are canonical across input ordering", () => {
  const first = rule({ id: "rule_a", pattern: "https://*" });
  const second = rule({ id: "rule_b", pattern: "https://evil.example/*" });
  assert.equal(
    evaluate([first, second]).policySnapshotHash,
    evaluate([second, first]).policySnapshotHash,
  );
});
