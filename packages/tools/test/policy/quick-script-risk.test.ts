import assert from "node:assert/strict";
import test from "node:test";
import {
  builtInPermissionRuleSet,
  composeEffectivePermissionPolicy,
  evaluatePermissionRequest,
  normalizePermissionRequest,
} from "../../src/policy/index.js";
import { requireToolDefinition } from "../../src/catalog/manifest.js";

const roots = {
  project: "/workspace",
  nerve_home: "/nerve",
  nerve_data: "/nerve/data",
  plans: "/nerve/data/plans",
};

function decision(ruleSet: string, code: string) {
  const request = normalizePermissionRequest({
    toolName: "quick_script",
    args: { code },
    roots,
    conversationId: "conv_test",
  });
  const policy = composeEffectivePermissionPolicy({
    selectedRuleSet: builtInPermissionRuleSet(ruleSet),
  });
  return evaluatePermissionRequest({ request, policy }).decision;
}

test("quick-script scripts are matched on the risk of their script", () => {
  const read = `await files.list()`;
  const network = `await jira.issues.get("A-1")`;
  const write = `await confluence.pages.update({ id: "1", title: "t" })`;
  const alias = `const j = jira; await j["issues"].get("A-1")`;
  assert.equal(decision("supervised", read), "allow");
  assert.equal(decision("supervised", network), "prompt");
  assert.equal(decision("autonomous", network), "allow");
  assert.equal(decision("planning", network), "allow");
  assert.equal(decision("read_only", network), "deny");
  assert.equal(decision("supervised", write), "prompt");
  assert.equal(decision("supervised", alias), "prompt");
  assert.equal(decision("read_only", read), "allow");
  assert.notEqual(decision("read_only", write), "allow");
});

test("planning and read-only allow read scripts and never auto-allow writes", () => {
  const read = `await files.list()`;
  const network = `await jira.issues.get("A-1"); await confluence.pages.get("1")`;
  const write = `await jira.issues.update({ key: "A-1", fields: { summary: "x" } })`;
  const destructive = `await jira.request("DELETE", "/rest/api/3/issue/A-1")`;
  for (const ruleSet of ["planning", "read_only"]) {
    assert.equal(decision(ruleSet, read), "allow", `${ruleSet} read`);
    assert.equal(
      decision(ruleSet, network),
      ruleSet === "planning" ? "allow" : "deny",
      `${ruleSet} network`,
    );
    assert.equal(decision(ruleSet, write), "deny", `${ruleSet} write`);
    assert.equal(
      decision(ruleSet, destructive),
      "deny",
      `${ruleSet} destructive`,
    );
  }
  assert.equal(decision("supervised", write), "prompt");
  assert.equal(decision("autonomous", write), "allow");
});

test("a Jira write script is classified external_write", () => {
  const args = {
    code: `await jira.issues.update({ key: "A-1", fields: { summary: "x" } })`,
  };
  assert.equal(
    requireToolDefinition("quick_script").classifyRisk?.(args),
    "external_write",
  );
});

test("quick_script has its own permission group", () => {
  const request = normalizePermissionRequest({
    toolName: "quick_script",
    args: { code: "return 1" },
    roots,
    conversationId: "conv_test",
  });
  const policy = composeEffectivePermissionPolicy({
    selectedRuleSet: {
      ...builtInPermissionRuleSet("supervised"),
      rules: [
        {
          id: "group-prompt",
          enabled: true,
          priority: 10_000,
          enforcement: "overridable",
          when: { toolGroups: ["quickScript"] },
          decision: "prompt",
        },
        ...builtInPermissionRuleSet("supervised").rules,
      ],
    },
  });
  assert.equal(
    evaluatePermissionRequest({ request, policy }).winningRuleId,
    "group-prompt",
  );
});
