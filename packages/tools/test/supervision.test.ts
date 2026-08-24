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
    cwd: "/workspace",
    workspaceRoots: ["/workspace"],
    rules,
  });
}

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
