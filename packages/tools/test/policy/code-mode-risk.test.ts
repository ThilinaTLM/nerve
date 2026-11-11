import assert from "node:assert/strict";
import test from "node:test";
import {
  builtInPermissionRuleSet,
  composeEffectivePermissionPolicy,
  evaluatePermissionRequest,
  normalizePermissionRequest,
} from "../../src/policy/index.js";

const roots = {
  project: "/workspace",
  nerve_home: "/nerve",
  nerve_data: "/nerve/data",
  plans: "/nerve/data/plans",
};

function decision(ruleSet: string, code: string) {
  const request = normalizePermissionRequest({
    toolName: "atlassian_code_mode",
    args: { code },
    roots,
    conversationId: "conv_test",
  });
  const policy = composeEffectivePermissionPolicy({
    selectedRuleSet: builtInPermissionRuleSet(ruleSet),
  });
  return evaluatePermissionRequest({ request, policy }).decision;
}

test("code-mode scripts are matched on the risk of their script", () => {
  const read = `await jira.issues.get("A-1")`;
  const write = `await confluence.pages.update({ id: "1", title: "t" })`;
  const alias = `const j = jira; await j["issues"].get("A-1")`;
  assert.equal(decision("supervised", read), "allow");
  assert.equal(decision("supervised", write), "prompt");
  assert.equal(decision("supervised", alias), "prompt");
  assert.equal(decision("read_only", read), "allow");
  assert.notEqual(decision("read_only", write), "allow");
});
