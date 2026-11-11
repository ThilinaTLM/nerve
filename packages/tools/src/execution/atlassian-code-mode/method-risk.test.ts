import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyToolRisk } from "../../catalog/manifest.js";
import {
  describeToolArgumentErrors,
  normalizeToolArguments,
  requireToolDefinition,
} from "../../catalog/index.js";
import { markdownToAdf } from "../jira/markdown-adf.js";
import { adfToMarkdown } from "../jira/adf-markdown.js";
import { createSdkEnvironment, findSdkMethod, sdkMethodNames } from "./sdk.js";
import {
  assertDeclaredRisk,
  classifyCodeModeScript,
  codeModeRiskOfToolRisk,
  codeModeToolRisk,
} from "./script-risk.js";

/** Representative arguments for every SDK method; a new method must be added here. */
const SAMPLES: Record<string, unknown[][]> = {
  "jira.issues.search": [["project = A"]],
  "jira.issues.get": [["A-1"], [{ key: "A-1", transitions: true }]],
  "jira.projects.get": [["A"], [{ key: "A", include: ["fields", "epics"] }]],
  "jira.users.search": [["ann"]],
  "jira.fields.list": [[]],
  "jira.issues.create": [[{ type: "Bug", summary: "s" }]],
  "jira.issues.update": [[{ key: "A-1", fields: { Summary: "s" } }]],
  "jira.issues.transition": [
    [{ key: "A-1", to: "Done" }],
    [{ key: "A-1", to: "Done", comment: "x" }],
  ],
  "jira.issues.link": [[{ key: "A-1", to: "A-2", type: "Blocks" }]],
  "jira.issues.move": [
    [{ keys: ["A-1"], sprint: 3 }],
    [{ keys: ["A-1"], sprint: "backlog" }],
  ],
  "jira.comments.add": [[{ key: "A-1", body: "x" }]],
  "jira.comments.update": [[{ key: "A-1", id: "1", body: "x" }]],
  "jira.comments.delete": [[{ key: "A-1", id: "1" }]],
  "jira.worklogs.add": [[{ key: "A-1", time: "1h" }]],
  "jira.attachments.upload": [[{ key: "A-1", file: "a.png" }]],
  "jira.request": [
    ["GET", "/x"],
    ["POST", "/x", {}],
    ["DELETE", "/x"],
  ],
  "confluence.spaces.search": [["S"]],
  "confluence.pages.search": [["type = page"]],
  "confluence.pages.get": [["1"]],
  "confluence.pages.create": [
    [{ space: "S", title: "t", body: "<p>x</p>", format: "storage" }],
    [
      {
        space: "S",
        title: "t",
        body: "<p>x</p>",
        format: "storage",
        attachments: ["a.png"],
      },
    ],
  ],
  "confluence.pages.update": [
    [{ id: "1", title: "t" }],
    [{ id: "1", title: "t", attachments: ["a.png"] }],
  ],
  "confluence.attachments.upload": [[{ id: "1", file: "a.png" }]],
  "confluence.labels.add": [[{ id: "1", labels: ["a"] }]],
  "confluence.comments.add": [[{ id: "1", body: "x" }]],
  "confluence.request": [
    ["GET", "/x"],
    ["PUT", "/x", {}],
    ["DELETE", "/x"],
  ],
  "diagram.render": [[{ type: "mermaid", source: "graph TD; A-->B" }]],
  "files.list": [[]],
  "files.read": [["artifact:a.txt"], ["notes.txt"]],
  "files.write": [
    ["a.txt", { text: "x" }],
    ["a.txt", { text: "x" }, { workspace: true }],
  ],
  "image.info": [[{ file: "a.png", ops: {} }]],
  "image.save": [[{ file: "a.png", ops: {}, name: "b.png" }]],
};

const env = createSdkEnvironment({
  cwd: process.cwd(),
  conversationDir: "/tmp/code-mode",
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
      // Admission validates nested calls against the direct tool's schema.
      for (const check of checks) {
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
  const comment = {
    toolName: "jira_manage_comment",
    args: { action: "create" },
  };
  const remove = {
    toolName: "jira_manage_comment",
    args: { action: "delete" },
  };
  assertDeclaredRisk("m", "write", [comment]);
  assert.throws(
    () => assertDeclaredRisk("m", "write", [remove]),
    /Internal error: m declares risk "write" but is authorized as jira_manage_comment with destructive risk/,
  );
  assert.throws(
    () => assertDeclaredRisk("m", "read", [comment]),
    /declares risk "read"/,
  );
  assert.throws(() =>
    assertDeclaredRisk("m", "none", [{ toolName: "read", args: {} }]),
  );
});

void test("direct manage tools are write, and destructive only for deletes", () => {
  const risk = (tool: string, args: Record<string, unknown>) =>
    codeModeToolRisk(tool as never, args);
  for (const [tool, args] of [
    ["jira_manage_comment", { action: "create" }],
    ["jira_manage_worklog", { action: "update" }],
    ["jira_manage_issue_link", { action: "create" }],
    ["confluence_manage_comment", { action: "create" }],
    ["confluence_manage_attachment", { action: "upload" }],
    ["confluence_manage_label", { action: "add" }],
  ] as const)
    assert.equal(risk(tool, args), "workspace_write", tool);
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

void test("effective tool risks map conservatively onto the code-mode scale", () => {
  for (const [risk, expected] of [
    ["read", "read"],
    ["network", "read"],
    ["interaction", "read"],
    ["workspace_write", "workspace_write"],
    ["command", "workspace_write"],
    ["destructive", "destructive"],
    ["secret", "destructive"],
    ["deployment", "destructive"],
    ["agent_spawn", "destructive"],
  ] as const)
    assert.equal(codeModeRiskOfToolRisk(risk), expected, risk);
});

void test("scripts are classified from the method table: adding is a write, deleting destructive", () => {
  const risk = (code: string) => classifyCodeModeScript(code).risk;
  assert.equal(
    risk(`await jira.comments.add({ key: "A-1", body: "x" })`),
    "workspace_write",
  );
  assert.equal(
    risk(`await jira.issues.transition({ key: "A-1", to: "Done" })`),
    "workspace_write",
  );
  assert.equal(
    risk(`await jira.comments.delete({ key: "A-1", id: "1" })`),
    "destructive",
  );
  assert.equal(
    risk(`await jira.projects.get({ key: "A", include: ["epics"] })`),
    "read",
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

void test("raw non-GET requests are never admitted by another tool's allow rule; GET stays a read check", () => {
  for (const product of ["jira", "confluence"]) {
    const request = findSdkMethod(`${product}.request`)!;
    const get = request.prepare(["get", "/x"], env).authorization!;
    assert.equal(get.approvalRequired, undefined);
    for (const verb of ["POST", "PUT", "PATCH", "DELETE"]) {
      const write = request.prepare([verb, "/x/1"], env).authorization!;
      assert.equal(write.approvalRequired, true, `${product} ${verb}`);
      assert.equal(write.summary, `${verb} /x/1`);
    }
  }
});
