import assert from "node:assert/strict";
import { test } from "node:test";
import { hostRegistry } from "../../../../core-host/host-tools.js";
import {
  REMOVED_TOOL_OPERATIONS,
  convertPermissionOverlayDocument,
  convertRemovedToolException,
  convertRuleSetDocument,
} from "./removed-tools.js";

const findQuickScriptNamespace = (id: string) =>
  hostRegistry.namespaces.find((namespace) => namespace.id === id);

void test("the network risk category becomes external_read in overlays and rule sets", () => {
  const rule = (id: string, baseRisks: string[]) => ({
    id,
    enabled: true,
    priority: 1,
    enforcement: "overridable",
    when: { baseRisks },
    decision: "allow",
  });
  const lost: string[] = [];
  const overlay = convertPermissionOverlayDocument(
    {
      schemaVersion: 2,
      overlays: [
        {
          ruleSetId: "x",
          rules: [rule("a", ["network", "read"]), rule("b", ["write"])],
        },
      ],
    },
    (reason) => lost.push(reason),
  );
  assert.equal(overlay.changed, true);
  const rules = (
    overlay.document as {
      overlays: { rules: { when: { baseRisks: string[] } }[] }[];
    }
  ).overlays[0].rules;
  assert.deepEqual(rules[0].when.baseRisks, ["external_read", "read"]);
  assert.deepEqual(rules[1].when.baseRisks, ["write"]);
  const set = convertRuleSetDocument(
    { schemaVersion: 1, rules: [rule("c", ["network", "external_read"])] },
    (reason) => lost.push(reason),
  );
  assert.deepEqual(
    (set.document as { rules: { when: { baseRisks: string[] } }[] }).rules[0]
      .when.baseRisks,
    ["external_read"],
  );
  assert.equal(
    convertRuleSetDocument({ rules: [rule("d", ["read"])] }, () => {}).changed,
    false,
  );
  assert.deepEqual(lost, []);
});

void test("the removed-tool table names real SDK methods for every removed tool", () => {
  assert.equal(Object.keys(REMOVED_TOOL_OPERATIONS).length, 30);
  for (const [tool, route] of Object.entries(REMOVED_TOOL_OPERATIONS)) {
    assert.ok(route.operations.length > 0 || route.raw, tool);
    for (const operation of [
      ...route.operations,
      ...(route.raw ? [`${route.raw}.request`] : []),
    ]) {
      const [namespace, ...path] = operation.split(".");
      const methods = findQuickScriptNamespace(namespace)?.methods ?? [];
      assert.ok(
        methods.some((method) => method.path === path.join(".")),
        `${tool} -> ${operation}`,
      );
    }
  }
});

void test("exceptions naming removed tools become quick_script operation globs", () => {
  const exception = (tool: string, effect = "allow") => ({
    id: "exception_1",
    tool,
    effect,
    rule: "*",
  });
  assert.deepEqual(
    convertRemovedToolException(exception("jira_manage_comment")),
    [
      {
        id: "exception_1",
        tool: "quick_script",
        effect: "allow",
        rule: "jira.comments.*",
      },
    ],
  );
  assert.deepEqual(convertRemovedToolException(exception("kroki_export")), [
    {
      id: "exception_1",
      tool: "quick_script",
      effect: "allow",
      rule: "diagram.render",
    },
  ]);
  assert.equal(
    convertRemovedToolException(exception("confluence_manage_restriction")),
    null,
  );
  assert.deepEqual(
    convertRemovedToolException(
      exception("confluence_manage_restriction", "deny"),
    ),
    [
      {
        id: "exception_1",
        tool: "quick_script",
        effect: "deny",
        rule: "confluence.request",
      },
    ],
  );
  assert.deepEqual(convertRemovedToolException(exception("bash")), [
    exception("bash"),
  ]);
});

void test("rules matching unknown also match external_write", () => {
  const rule = (id: string, baseRisks: string[]) => ({
    id,
    enabled: true,
    priority: 1,
    enforcement: "overridable",
    when: { baseRisks },
    decision: "prompt",
  });
  const risks = (document: unknown) =>
    (document as { rules: { when: { baseRisks: string[] } }[] }).rules.map(
      (r) => r.when.baseRisks,
    );
  const set = convertRuleSetDocument(
    {
      rules: [
        rule("a", ["unknown", "read"]),
        rule("b", ["unknown", "external_write"]),
        rule("c", ["read"]),
      ],
    },
    () => {},
  );
  assert.equal(set.changed, true);
  assert.deepEqual(risks(set.document), [
    ["unknown", "read", "external_write"],
    ["unknown", "external_write"],
    ["read"],
  ]);
  const overlay = convertPermissionOverlayDocument(
    { overlays: [{ ruleSetId: "x", rules: [rule("d", ["unknown"])] }] },
    () => {},
  );
  assert.deepEqual(
    (
      overlay.document as {
        overlays: { rules: { when: { baseRisks: string[] } }[] }[];
      }
    ).overlays[0].rules[0].when.baseRisks,
    ["unknown", "external_write"],
  );
  assert.equal(
    convertRuleSetDocument(
      { rules: [rule("e", ["unknown", "external_write"])] },
      () => {},
    ).changed,
    false,
  );
});

void test("write rules that covered whole scripts also match external_write; broad allows do not", () => {
  const rule = (id: string, when: object, decision: string) => ({
    id,
    enabled: true,
    priority: 1,
    enforcement: "guardrail",
    when,
    decision,
  });
  const { document } = convertRuleSetDocument(
    {
      rules: [
        rule(
          "script",
          { toolNames: ["quick_script"], baseRisks: ["write"] },
          "allow",
        ),
        rule("deny", { baseRisks: ["write"] }, "deny"),
        rule("allow", { baseRisks: ["write"] }, "allow"),
        rule(
          "files",
          { toolNames: ["write", "edit"], baseRisks: ["write"] },
          "deny",
        ),
      ],
    },
    () => {},
  );
  assert.deepEqual(
    (document as { rules: { when: { baseRisks: string[] } }[] }).rules.map(
      (r) => r.when.baseRisks,
    ),
    [
      ["write", "external_write"],
      ["write", "external_write"],
      ["write"],
      ["write"],
    ],
  );
});
