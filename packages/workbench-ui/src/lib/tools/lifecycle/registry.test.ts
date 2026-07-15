import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toolNameSchema, type ToolName } from "@nervekit/contracts";
import {
  isKnownToolName,
  presentToolArguments,
  toolLifecycleRegistry,
  toolLifecycleSpec,
  unknownToolLifecycleSpec,
} from "./registry";

const cases: Array<[ToolName, Record<string, unknown>, string]> = [
  ["read", { path: "src/app.ts" }, "src/app.ts"],
  ["bash", { command: "pnpm test" }, "pnpm test"],
  ["python", { path: "scripts/report.py" }, "scripts/report.py"],
  ["edit", { path: "src/app.ts", patch: "-old\n+new" }, "src/app.ts"],
  ["write", { path: "src/new.ts", content: "hello" }, "src/new.ts"],
  ["grep", { pattern: "TODO" }, "TODO"],
  ["find", { pattern: "**/*.ts" }, "**/*.ts"],
  ["ls", { path: "src" }, "src"],
  ["ask_user", { question: "Which option?" }, "Which option?"],
  ["todos_set", { todos: [{ todo: "Test", done: false }] }, "todos"],
  ["todos_get", {}, "Get todos"],
  ["web_search", { query: "Svelte lifecycle" }, "Svelte lifecycle"],
  ["web_fetch", { url: "https://example.com" }, "https://example.com"],
  ["jira_search_users", { query: "Taylor" }, "Taylor"],
  ["jira_search_issues", { jql: "project = NER" }, "project = NER"],
  ["jira_get_issue", { issue_key: "NER-1" }, "NER-1"],
  ["jira_get_project", { project_key: "NER" }, "NER"],
  [
    "jira_create_issue",
    { project_key: "NER", issue_type: "Task", summary: "Ship it" },
    "Ship it",
  ],
  ["jira_update_issue", { issue_key: "NER-1", summary: "Updated" }, "NER-1"],
  ["jira_add_comment", { issue_key: "NER-1", body: "Looks good" }, "NER-1"],
  [
    "jira_transition_issue",
    { issue_key: "NER-1", transition: "Done" },
    "NER-1",
  ],
  ["confluence_search_spaces", { query: "Engineering" }, "Engineering"],
  ["confluence_search_pages", { cql: "type = page" }, "type = page"],
  ["confluence_get_page", { page_id: "123" }, "123"],
  ["confluence_download_pages", { space_key: "ENG" }, "ENG"],
  [
    "confluence_create_page",
    { space_key: "ENG", title: "Runbook", body: "Text" },
    "Runbook",
  ],
  ["confluence_update_page", { page_id: "123", title: "Runbook" }, "123"],
  [
    "confluence_publish_pages",
    { input_path: "/tmp/pages.jsonl" },
    "pages.jsonl",
  ],
  [
    "confluence_upload_attachment",
    { page_id: "123", file_path: "/tmp/report.pdf" },
    "report.pdf",
  ],
  ["task_start", { name: "dev", command: "pnpm dev" }, "dev"],
  ["task_status", { taskIds: ["one", "two"] }, "2 tasks"],
  ["task_logs", { taskId: "dev" }, "dev"],
  ["task_cancel", { taskId: "dev" }, "dev"],
  ["task_restart", { taskId: "dev" }, "dev"],
  [
    "explore",
    { task: "Investigate the lifecycle registry", label: "Lifecycle" },
    "Lifecycle",
  ],
  ["plan_mode_enter", { reason: "Complex change" }, "Enter planning mode"],
  [
    "plan_mode_present",
    { file_path: "/plans/tool.md", title: "Tool lifecycle" },
    "tool.md",
  ],
  [
    "plan_mode_force_exit",
    { reason: "No longer needed" },
    "Exit planning mode",
  ],
];

describe("tool lifecycle registry", () => {
  it("has exactly one typed spec for every active tool", () => {
    assert.deepEqual(
      Object.keys(toolLifecycleRegistry).sort(),
      [...toolNameSchema.options].sort(),
    );
    for (const name of toolNameSchema.options) {
      const spec = toolLifecycleRegistry[name];
      assert.equal(spec.name, name);
      assert.ok(spec.completedView);
      assert.equal(isKnownToolName(name), true);
    }
  });

  it("derives a readable primary argument for every catalog row", () => {
    assert.equal(cases.length, toolNameSchema.options.length);
    for (const [name, args, expected] of cases) {
      const presentation = presentToolArguments(
        name,
        { args },
        "drafting",
        "/project",
      );
      assert.ok(presentation.primaryArg, name);
      assert.match(
        presentation.primaryArg.text,
        new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        name,
      );
      assert.notEqual(presentation.body.kind, "json", name);
    }
  });

  it("uses the clickable plan filename instead of the review title", () => {
    const planPath = "C:\\Users\\Taylor\\.nerve\\plans\\tool-lifecycle.md";
    const presentation = presentToolArguments(
      "plan_mode_present",
      {
        args: {
          file_path: planPath,
          title: "Tool lifecycle",
        },
      },
      "completed",
    );

    assert.equal(presentation.primaryArg?.text, "tool-lifecycle.md");
    assert.equal(presentation.primaryArg?.openPath, planPath);
  });

  it("encodes interaction, retained-proposal, and immediate-result handoffs", () => {
    assert.equal(
      toolLifecycleRegistry.ask_user.executionHandoff,
      "replace-with-interaction",
    );
    assert.equal(
      toolLifecycleRegistry.plan_mode_present.executionHandoff,
      "replace-with-interaction",
    );
    for (const name of [
      "write",
      "edit",
      "bash",
      "python",
      "jira_create_issue",
      "confluence_update_page",
    ] as const) {
      assert.equal(
        toolLifecycleRegistry[name].executionHandoff,
        "retain-draft-until-output",
        name,
      );
    }
    for (const name of ["read", "grep", "find", "ls", "web_search"] as const) {
      assert.equal(
        toolLifecycleRegistry[name].executionHandoff,
        "result-immediate",
        name,
      );
    }
  });

  it("shows decision-relevant mutation details and dry-run intent", () => {
    const jira = presentToolArguments(
      "jira_create_issue",
      {
        args: {
          project_key: "NER",
          issue_type: "Task",
          summary: "Add lifecycle registry",
          description: "A bounded description",
          assignee_query: "Taylor",
          priority: "High",
          dry_run: true,
        },
      },
      "approval",
    );
    assert.equal(jira.body.kind, "atlassian-summary");
    assert.match(
      jira.body.kind === "atlassian-summary" ? jira.body.text : "",
      /Project: NER/,
    );
    assert.match(
      jira.body.kind === "atlassian-summary" ? jira.body.text : "",
      /Assignee: Taylor/,
    );
    assert.ok(jira.secondary.some((item) => item.text === "dry run"));
    assert.match(jira.safetyNotes.join(" "), /will not create/i);

    const edit = presentToolArguments(
      "edit",
      {
        args: {
          path: "src/app.ts",
          dryRun: true,
          replacements: [{ oldText: "old", newText: "new" }],
        },
      },
      "approval",
    );
    assert.equal(edit.body.kind, "diff");
    assert.match(
      edit.body.kind === "diff" ? edit.body.text : "",
      /-old\n\+new/,
    );
    assert.ok(edit.secondary.some((item) => item.text === "dry run"));
  });

  it("shows environment key names but never values in approvals", () => {
    const presentation = presentToolArguments(
      "task_start",
      {
        args: {
          name: "dev",
          command: "pnpm dev",
          env: { API_TOKEN: "super-secret-value", NODE_ENV: "development" },
          readyOnUrl: true,
        },
      },
      "approval",
    );
    const serialized = JSON.stringify(presentation);
    assert.match(serialized, /API_TOKEN/);
    assert.match(serialized, /NODE_ENV/);
    assert.doesNotMatch(serialized, /super-secret-value|development/);
  });

  it("uses a separate redacted fallback for unknown historical tools", () => {
    assert.equal(
      toolLifecycleSpec("removed_extension"),
      unknownToolLifecycleSpec,
    );
    const presentation = presentToolArguments(
      "removed_extension",
      {
        args: {
          target: "workspace",
          api_token: "secret-value",
          count: 3,
        },
      },
      "completed",
    );
    assert.equal(presentation.body.kind, "key-values");
    const serialized = JSON.stringify(presentation);
    assert.match(serialized, /workspace/);
    assert.match(serialized, /\[redacted\]/);
    assert.doesNotMatch(serialized, /secret-value/);
  });
});
