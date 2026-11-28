import { registry } from "./registry.js";
import assert from "node:assert/strict";
import test from "node:test";
import {
  builtInPermissionRuleSet,
  composeEffectivePermissionPolicy,
  evaluatePermissionRequest,
  normalizePermissionRequest,
} from "@nervekit/tools/policy";
import {
  classifyToolRiskAsync,
  registerToolDefinitions,
  requireToolDefinition,
} from "@nervekit/tools/catalog";
import { createQuickScriptToolDefinition } from "@nervekit/tools/quick-script";

registerToolDefinitions([createQuickScriptToolDefinition(registry)]);

const roots = {
  project: "/workspace",
  nerve_home: "/nerve",
  nerve_data: "/nerve/data",
  plans: "/nerve/data/plans",
};

async function decision(ruleSet: string, code: string) {
  const request = normalizePermissionRequest({
    toolName: "quick_script",
    args: { code },
    roots,
    conversationId: "conv_test",
  });
  request.argumentRisk = await classifyToolRiskAsync("quick_script", { code });
  const policy = composeEffectivePermissionPolicy({
    selectedRuleSet: builtInPermissionRuleSet(ruleSet),
  });
  return evaluatePermissionRequest({ request, policy }).decision;
}

test("quick-script scripts are matched on the risk of their script", async () => {
  const read = `await artifacts.list()`;
  const network = `await jira.issues.get("A-1")`;
  const write = `await confluence.pages.update({ id: "1", title: "t" })`;
  const alias = `const j = jira; await j["issues"].get("A-1")`;
  assert.equal(await decision("supervised", read), "allow");
  assert.equal(await decision("supervised", network), "prompt");
  assert.equal(await decision("autonomous", network), "allow");
  assert.equal(await decision("planning", network), "allow");
  assert.equal(await decision("read_only", network), "allow");
  assert.equal(await decision("supervised", write), "prompt");
  assert.equal(await decision("supervised", alias), "prompt");
  assert.equal(await decision("read_only", read), "allow");
  assert.notEqual(await decision("read_only", write), "allow");
});

test("planning and read-only allow read and external-read scripts and never auto-allow writes", async () => {
  const read = `await artifacts.list()`;
  const network = `await jira.issues.get("A-1"); await confluence.pages.get("1")`;
  const write = `await jira.issues.update({ key: "A-1", fields: { summary: "x" } })`;
  const destructive = `await jira.request("DELETE", "/rest/api/3/issue/A-1")`;
  for (const ruleSet of ["planning", "read_only"]) {
    assert.equal(await decision(ruleSet, read), "allow", `${ruleSet} read`);
    assert.equal(
      await decision(ruleSet, network),
      "allow",
      `${ruleSet} network`,
    );
    assert.equal(await decision(ruleSet, write), "deny", `${ruleSet} write`);
    assert.equal(
      await decision(ruleSet, destructive),
      "deny",
      `${ruleSet} destructive`,
    );
  }
  assert.equal(await decision("supervised", write), "prompt");
  assert.equal(await decision("autonomous", write), "allow");
});

test("a Jira write script is classified external_write", async () => {
  const args = {
    code: `await jira.issues.update({ key: "A-1", fields: { summary: "x" } })`,
  };
  assert.equal(
    await requireToolDefinition("quick_script").classifyRiskAsync?.(args),
    "external_write",
  );
});

test("quick_script has its own permission group", async () => {
  const request = normalizePermissionRequest({
    toolName: "quick_script",
    args: { code: "return 1" },
    roots,
    conversationId: "conv_test",
  });
  request.argumentRisk = "read";
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
