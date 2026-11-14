import assert from "node:assert/strict";
import test from "node:test";
import type { PermissionRule } from "@nervekit/contracts/permissions";
import { registerToolDefinitions } from "@nervekit/tools/catalog";
import {
  builtInPermissionRuleSet,
  composeEffectivePermissionPolicy,
  composeScriptAdmission,
  evaluatePermissionRequest,
  normalizePermissionRequest,
} from "@nervekit/tools/policy";
import { quickScriptToolDefinition } from "../tool.js";
import { classifyQuickScriptScript } from "./script-risk.js";

registerToolDefinitions([quickScriptToolDefinition]);

function scriptAdmission(
  calls: Parameters<typeof composeScriptAdmission>[0]["calls"],
  rules: PermissionRule[],
  selected = "supervised",
) {
  const policy = composeEffectivePermissionPolicy({
    selectedRuleSet: builtInPermissionRuleSet(selected),
    userOverlay: { ruleSetId: selected, rules },
  });
  // The script-level request: classified risk against risk-class rules.
  const script = evaluatePermissionRequest({
    policy,
    request: normalizePermissionRequest({
      toolName: "quick_script",
      args: { code: "await jira.comments.add({})" },
      roots: {
        project: "/w",
        nerve_home: "/n",
        nerve_data: "/n/d",
        plans: "/n/d/p",
      },
      conversationId: "conv_test",
    }),
  });
  return composeScriptAdmission({
    script,
    calls,
    policy,
    conversationId: "conv_test",
  });
}

const add = (target?: string) => ({
  operation: "jira.comments.add",
  risk: "external_write" as const,
  ...(target ? { targets: [target] } : {}),
});
const allowOps = (
  pattern?: string,
  operation = "jira.comments.add",
): PermissionRule => ({
  id: `allow-${operation.replaceAll(".", "-")}`,
  enabled: true,
  priority: 10,
  enforcement: "overridable",
  when: {
    toolNames: ["quick_script"],
    primaryArgument: { operator: "equals", value: operation },
    ...(pattern
      ? {
          targets: {
            quantifier: "all" as const,
            matcher: { kind: "resource" as const, pattern },
          },
        }
      : {}),
  },
  decision: "allow",
});

void test("a script whose every operation is allowed by operation rules is admitted by rule", () => {
  const admitted = scriptAdmission(
    [add("jira:issue/APP-1"), add("jira:issue/APP-2")],
    [allowOps("jira:issue/APP-*")],
  );
  assert.equal(admitted.byOperations, true);
  assert.equal(admitted.result.decision, "allow");
  assert.match(
    admitted.result.reason,
    /jira\.comments\.add · jira:issue\/APP-1/,
  );
});

void test("one uncovered operation keeps the script-level decision and suggests only that operation", () => {
  const admitted = scriptAdmission(
    [
      add("jira:issue/APP-1"),
      {
        operation: "jira.issues.delete",
        risk: "destructive",
        targets: ["jira:issue/APP-2"],
      },
    ],
    [allowOps("jira:issue/APP-*")],
  );
  assert.equal(admitted.byOperations, false);
  assert.equal(admitted.result.decision, "prompt");
  assert.deepEqual(
    admitted.result.suggestedRules.map((rule) => rule.when),
    [
      {
        toolNames: ["quick_script"],
        primaryArgument: { operator: "equals", value: "jira.issues.delete" },
        targets: {
          quantifier: "all",
          matcher: { kind: "resource", pattern: "jira:issue/APP-2" },
        },
      },
    ],
  );
});

void test("an operation rule that denies one operation denies the script", () => {
  const deny: PermissionRule = {
    ...allowOps("jira:issue/PROD-*", "jira.comments.add"),
    id: "deny-prod",
    priority: 20,
    decision: "deny",
  };
  const admitted = scriptAdmission(
    [add("jira:issue/APP-1"), add("jira:issue/PROD-1")],
    [allowOps(), deny],
  );
  assert.equal(admitted.result.decision, "deny");
  assert.match(
    admitted.result.reason,
    /^jira\.comments\.add · jira:issue\/PROD-1/,
  );
});

void test("unknown targets only match target-less rules", () => {
  assert.equal(
    scriptAdmission([add()], [allowOps("jira:issue/APP-*")]).result.decision,
    "prompt",
  );
  const open = scriptAdmission([add()], [allowOps()]);
  assert.equal(open.result.decision, "allow");
  // Unknown targets suggest the operation alone.
  const suggestion = scriptAdmission([add()], []).result.suggestedRules;
  assert.deepEqual(
    suggestion.map((rule) => rule.when.targets),
    [undefined],
  );
});

void test("operation rules cannot outrank a guardrail script-level deny, and built-in sets are unchanged", () => {
  const calls = [add("jira:issue/APP-1")];
  for (const id of ["supervised", "read_only", "planning", "autonomous"]) {
    const plain = scriptAdmission(calls, [], id);
    assert.equal(plain.byOperations, false, id);
  }
  const guard: PermissionRule = {
    id: "guard-scripts",
    enabled: true,
    priority: 1,
    enforcement: "guardrail",
    when: { toolNames: ["quick_script"], baseRisks: ["write"] },
    decision: "deny",
  };
  const admitted = scriptAdmission(calls, [guard, allowOps()]);
  assert.equal(admitted.result.decision, "deny");
});

void test("the scan hands operation rules normalized targets, and marks scripts it cannot fully analyse", () => {
  const scan = classifyQuickScriptScript(
    `await jira.comments.add({ key: "SCRUM-1", body: "x" }); await confluence.pages.get("12"); await jira.request("delete", "/rest/api/3/issue/A-1")`,
  );
  assert.equal(scan.admissible, true);
  assert.deepEqual(scan.calls, [
    {
      operation: "jira.comments.add",
      risk: "external_write",
      targets: ["jira:issue/SCRUM-1"],
    },
    {
      operation: "confluence.pages.get",
      risk: "network",
      targets: ["confluence:page/12"],
    },
    {
      operation: "jira.request",
      risk: "destructive",
      targets: ["jira:request/DELETE /rest/api/3/issue/A-1"],
    },
  ]);
  // A variable key: the operation is known, its targets are not.
  assert.equal(
    classifyQuickScriptScript(`await jira.issues.get(k)`).calls[0]?.targets,
    undefined,
  );
  // Incomplete scans never reach operation rules.
  for (const code of [
    `const f = jira.issues.get; await f("A-1")`,
    `await jira.request(m, "/x")`,
    `await web.fetch("https://x.test")`,
    `await jira.issues.get("A-1"); eval("1")`,
  ])
    assert.equal(classifyQuickScriptScript(code).admissible, false, code);
});
