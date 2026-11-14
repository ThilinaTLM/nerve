import assert from "node:assert/strict";
import test from "node:test";
import type {
  PermissionOverlay,
  PermissionRule,
} from "@nervekit/contracts/permissions";
import {
  builtInPermissionRuleSet,
  composeEffectivePermissionPolicy,
  evaluatePermissionRequest,
  normalizeOperationRequest,
  suggestOperationRules,
  operationBaseRisk,
} from "../../src/policy/index.js";

void test("quick_script operations match by operation, namespace group and resource targets", () => {
  const rule: PermissionRule = {
    id: "allow-app-issue-writes",
    enabled: true,
    priority: 10,
    enforcement: "overridable",
    when: {
      toolNames: ["quick_script"],
      primaryArgument: {
        operator: "in",
        value: ["jira.issues.create", "jira.issues.update"],
      },
      targets: {
        quantifier: "all",
        matcher: { kind: "resource", pattern: "jira:*/APP*" },
      },
    },
    decision: "allow",
  };
  const overlay: PermissionOverlay = { ruleSetId: "supervised", rules: [rule] };
  const operation = (
    name: string,
    targets: string[],
    risk: "network" | "external_write" | "destructive",
  ) =>
    evaluatePermissionRequest({
      request: normalizeOperationRequest({
        operation: name,
        targets,
        risk,
        conversationId: "conv_test",
      }),
      policy: composeEffectivePermissionPolicy({
        selectedRuleSet: builtInPermissionRuleSet("supervised"),
        userOverlay: overlay,
      }),
    });
  assert.equal(
    operation("jira.issues.update", ["jira:issue/APP-1"], "external_write")
      .decision,
    "allow",
  );
  // Another project, another operation, or one target outside the glob is not covered.
  for (const denied of [
    operation("jira.issues.update", ["jira:issue/OPS-1"], "external_write"),
    operation("jira.issues.delete", ["jira:issue/APP-1"], "destructive"),
    operation(
      "jira.issues.update",
      ["jira:issue/APP-1", "jira:issue/OPS-1"],
      "external_write",
    ),
  ])
    assert.equal(denied.decision, "prompt");
  // The suggested rule names the operation and the exact target.
  const suggestion = operation(
    "jira.issues.delete",
    ["jira:issue/APP-1"],
    "destructive",
  ).suggestedRules[0]!;
  assert.deepEqual(suggestion.when, {
    toolNames: ["quick_script"],
    primaryArgument: { operator: "equals", value: "jira.issues.delete" },
    targets: {
      quantifier: "all",
      matcher: { kind: "resource", pattern: "jira:issue/APP-1" },
    },
  });
});

void test("operations never get the write base risk, and the namespace is the tool group", () => {
  const baseRisk = (risk: Parameters<typeof operationBaseRisk>[0]) =>
    operationBaseRisk(risk);
  assert.equal(baseRisk("network"), "network");
  assert.equal(baseRisk("external_write"), "unknown");
  assert.equal(baseRisk("destructive"), "destructive");
  const request = normalizeOperationRequest({
    operation: "confluence.pages.update",
    targets: [],
    risk: "external_write",
    conversationId: "conv_test",
  });
  const planning = composeEffectivePermissionPolicy({
    selectedRuleSet: builtInPermissionRuleSet("planning"),
  });
  assert.equal(
    evaluatePermissionRequest({ request, policy: planning }).decision,
    "deny",
  );
  assert.equal(
    evaluatePermissionRequest({
      request: normalizeOperationRequest({
        operation: "confluence.pages.get",
        targets: ["confluence:page/1"],
        risk: "network",
        conversationId: "conv_test",
      }),
      policy: planning,
    }).decision,
    "allow",
  );
});

void test("a multi-target operation suggests one brace pattern over its targets", () => {
  const [rule] = suggestOperationRules([
    {
      operation: "jira.issues.link",
      risk: "external_write",
      targets: ["jira:issue/A-2", "jira:issue/A-1"],
    },
  ]);
  assert.equal(
    rule!.when.targets!.matcher.pattern,
    "{jira:issue/A-1,jira:issue/A-2}",
  );
});
