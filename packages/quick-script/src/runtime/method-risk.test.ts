import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyToolRisk } from "@nervekit/tools/catalog";
import {
  describeToolArgumentErrors,
  normalizeToolArguments,
  requireToolDefinition,
} from "@nervekit/tools/catalog";
import { markdownToAdf } from "@nervekit/tools/integrations";
import { adfToMarkdown } from "@nervekit/tools/integrations";
import { SAMPLES } from "./method-samples.js";
import { type MethodRisk, isOperationCheck } from "./sdk-types.js";
import { createSdkEnvironment, findSdkMethod, sdkMethodNames } from "./sdk.js";
import {
  assertDeclaredRisk,
  classifyQuickScriptScript,
  quickScriptRiskOfToolRisk,
  quickScriptToolRisk,
} from "./script-risk.js";

const env = createSdkEnvironment({
  cwd: process.cwd(),
  conversationDir: "/tmp/quick-script",
  web: { enabled: true, search: true },
});

void test("every method has samples, and its declared risk covers every authorization it produces", () => {
  assert.deepEqual(Object.keys(SAMPLES).sort(), [...sdkMethodNames()].sort());
  for (const [name, calls] of Object.entries(SAMPLES)) {
    const method = findSdkMethod(name)!;
    for (const args of calls) {
      const prepared = method.prepare(args, env);
      const checks = [
        ...(prepared.authorization ? [prepared.authorization] : []),
        ...(prepared.additionalAuthorizations ?? []),
      ];
      assert.doesNotThrow(
        () => assertDeclaredRisk(name, method.risk, checks),
        `${name} ${JSON.stringify(args)}`,
      );
      for (const check of checks) {
        if (isOperationCheck(check)) {
          // Operations stay within the method's own namespace, except where a method reads several products.
          assert.ok(
            check.operation.startsWith(`${method.product}.`) ||
              name === "atlassian.defaults",
            `${name} -> ${check.operation}`,
          );
          for (const target of check.targets)
            assert.match(
              target.value,
              /^(jira|confluence):[a-z]+\/\S/,
              `${name} target ${target.value}`,
            );
          continue;
        }
        // Remaining direct tools are admitted against the tool's schema.
        const definition = requireToolDefinition(check.toolName);
        const errors = describeToolArgumentErrors(
          definition,
          normalizeToolArguments(definition, check.args),
        );
        assert.equal(
          errors,
          undefined,
          `${name} ${JSON.stringify(args)} -> ${check.toolName}: ${String(errors)}`,
        );
      }
    }
  }
});

void test("the guard refuses a declaration below the authorization's risk", () => {
  const direct = (toolName: string, args: Record<string, unknown>) => ({
    toolName,
    args,
    summary: "",
  });
  const comment = direct("jira_manage_comment", { action: "create" });
  const remove = direct("jira_manage_comment", { action: "delete" });
  assertDeclaredRisk("m", "write", [comment]);
  assert.throws(
    () => assertDeclaredRisk("m", "write", [remove]),
    /Internal error: m declares risk "write" but is authorized as jira_manage_comment with destructive risk/,
  );
  assert.throws(
    () => assertDeclaredRisk("m", "read", [comment]),
    /declares risk "read"/,
  );
  assert.throws(() => assertDeclaredRisk("m", "none", [direct("read", {})]));
  const operation = (risk: MethodRisk) => ({
    operation: "jira.x.y",
    targets: [],
    risk,
    summary: "",
  });
  assertDeclaredRisk("m", "destructive", [operation("network")]);
  assert.throws(
    () => assertDeclaredRisk("m", "network", [operation("destructive")]),
    /authorized as jira\.x\.y with destructive risk/,
  );
});

void test("direct manage tools are write, and destructive only for deletes", () => {
  const risk = (tool: string, args: Record<string, unknown>) =>
    quickScriptToolRisk(tool as never, args);
  for (const [tool, args] of [
    ["jira_manage_comment", { action: "create" }],
    ["jira_manage_worklog", { action: "update" }],
    ["jira_manage_issue_link", { action: "create" }],
    ["confluence_manage_comment", { action: "create" }],
    ["confluence_manage_attachment", { action: "upload" }],
    ["confluence_manage_label", { action: "add" }],
  ] as const)
    assert.equal(risk(tool, args), "external_write", tool);
  for (const [tool, args] of [
    ["jira_manage_comment", { action: "delete" }],
    ["jira_manage_issue_link", { action: "delete" }],
    ["confluence_manage_comment", { action: "delete" }],
    ["confluence_manage_attachment", { action: "delete" }],
  ] as const)
    assert.equal(risk(tool, args), "destructive", tool);
  assert.equal(
    classifyToolRisk("confluence_manage_attachment", { action: "delete" }),
    "destructive",
  );
});

void test("effective tool risks map conservatively onto the quick-script scale", () => {
  for (const [risk, expected] of [
    ["read", "read"],
    ["network", "network"],
    ["interaction", "read"],
    ["workspace_write", "workspace_write"],
    ["command", "external_write"],
    ["external_write", "destructive"],
    ["destructive", "destructive"],
    ["secret", "destructive"],
    ["deployment", "destructive"],
    ["agent_spawn", "destructive"],
  ] as const)
    assert.equal(quickScriptRiskOfToolRisk(risk), expected, risk);
});

void test("scripts are classified from the method table: adding is a write, deleting destructive", () => {
  const risk = (code: string) => classifyQuickScriptScript(code).risk;
  assert.equal(
    risk(`await jira.comments.add({ key: "A-1", body: "x" })`),
    "external_write",
  );
  assert.equal(
    risk(`await jira.issues.transition({ key: "A-1", to: "Done" })`),
    "external_write",
  );
  assert.equal(
    risk(`await jira.comments.delete({ key: "A-1", id: "1" })`),
    "destructive",
  );
  assert.equal(
    risk(`await jira.projects.get({ key: "A", include: ["epics"] })`),
    "network",
  );
});

void test("Markdown converts to ADF and back", () => {
  const markdown = [
    "## Plan",
    "",
    "Do **this** and `that` in [docs](https://x.test).",
    "",
    "- one",
    "  - nested",
    "- two",
    "",
    "1. first",
    "2. second",
    "",
    "```ts",
    "const a = 1;",
    "```",
  ].join("\n");
  const adf = markdownToAdf(markdown);
  assert.deepEqual(
    adf.content.map((node) => node.type),
    ["heading", "paragraph", "bulletList", "orderedList", "codeBlock"],
  );
  assert.equal(adfToMarkdown(adf), markdown);
});

void test("raw requests are checked as the request operation: GET is a network read, anything else destructive, with method and path as the target", () => {
  for (const product of ["jira", "confluence"]) {
    const request = findSdkMethod(`${product}.request`)!;
    assert.deepEqual(request.prepare(["get", "/x"], env).authorization, {
      operation: `${product}.request`,
      targets: [{ kind: "resource", value: `${product}:request/GET /x` }],
      risk: "network",
      summary: "GET /x",
    });
    for (const verb of ["POST", "PUT", "PATCH", "DELETE"]) {
      const write = request.prepare([verb, "/x/1"], env).authorization!;
      assert.equal(isOperationCheck(write) && write.risk, "destructive");
      assert.equal(write.summary, `${verb} /x/1`);
    }
  }
});
