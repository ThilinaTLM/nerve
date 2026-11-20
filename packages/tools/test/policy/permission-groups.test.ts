import assert from "node:assert/strict";
import test from "node:test";
import type { PermissionRule } from "@nervekit/contracts/permissions";
import type { ToolName } from "@nervekit/contracts/tools";
import { registerToolDefinitions } from "../../src/catalog/index.js";
import { createExtensionToolDefinitions } from "../../src/extension-host/direct-tools.js";
import { demoExtension } from "../../src/extension-host/test-extension.js";
import { createQuickScriptRegistry } from "../../src/quick-script/registry.js";
import {
  builtInPermissionRuleSet,
  composeEffectivePermissionPolicy,
  evaluatePermissionRequest,
  normalizeOperationRequest,
  normalizePermissionRequest,
} from "../../src/policy/index.js";

// An extension `web-search` whose namespace `search` has a tool bound to `search.items.get`.
const searchExtension = {
  ...demoExtension,
  id: "web-search",
  namespaces: demoExtension.namespaces!.map((namespace) => ({
    ...namespace,
    id: "search",
  })),
  tools: demoExtension.tools!.map((tool) => ({
    ...tool,
    name: "web_search",
    method: "search.items.get",
  })),
};
registerToolDefinitions(
  createExtensionToolDefinitions(createQuickScriptRegistry([searchExtension])),
);

function decide(
  groups: string[],
  route: "tool" | "operation",
  extensionId: string | null = "web-search",
) {
  const rule: PermissionRule = {
    id: "deny-group",
    enabled: true,
    priority: 10,
    enforcement: "overridable",
    when: { toolGroups: groups },
    decision: "deny",
  };
  const request =
    route === "tool"
      ? normalizePermissionRequest({
          toolName: "web_search" as ToolName,
          args: { id: "1" },
          conversationId: "conv_test",
          toolScope: "/tmp",
          cwd: "/tmp",
          roots: { project: "/tmp" },
        })
      : normalizeOperationRequest({
          operation: "search.items.get",
          targets: [],
          risk: "external_read",
          ...(extensionId === null ? {} : { extensionId }),
          conversationId: "conv_test",
        });
  return evaluatePermissionRequest({
    request,
    policy: composeEffectivePermissionPolicy({
      selectedRuleSet: builtInPermissionRuleSet("supervised"),
      userOverlay: { ruleSetId: "supervised", rules: [rule] },
    }),
  }).decision;
}

void test("a namespace or extension group rule covers the direct tool and the script operation", () => {
  for (const group of ["search", "web-search"])
    for (const route of ["tool", "operation"] as const)
      assert.equal(decide([group], route), "deny", `${group} via ${route}`);
});

void test("a rule naming an unrelated group matches neither route", () => {
  for (const route of ["tool", "operation"] as const)
    assert.notEqual(decide(["jira"], route), "deny", route);
});

void test("an operation of a runtime namespace carries only its namespace", () => {
  assert.equal(decide(["search"], "operation", null), "deny");
  assert.notEqual(decide(["web-search"], "operation", null), "deny");
});
