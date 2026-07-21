import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AgentRecord,
  PermissionLevel,
  ToolName,
} from "@nervekit/contracts";
import { evaluateToolPolicy } from "../src/domains/tools/policy.js";

function agent(
  permissionLevel: PermissionLevel,
  mode: AgentRecord["mode"] = "coding",
  approvalPolicy: AgentRecord["approvalPolicy"] = {
    autoApproveReadOnly: true,
  },
): AgentRecord {
  return {
    id: "agent_01HN0000000000000000000000",
    conversationId: "conv_01HN0000000000000000000000",
    projectId: "proj_01HN0000000000000000000000",
    projectDir: "/tmp/project",
    workerId: "worker_01HN0000000000000000000000",
    rootAgentId: "agent_01HN0000000000000000000000",
    mode,
    permissionLevel,
    approvalPolicy,
    workspaceScope: { roots: ["/tmp/project"] },
    budget: { depth: 0, maxDepth: 3, maxRuns: 8, usedRuns: 0 },
    status: "idle",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("tool policy", () => {
  it("applies supervised read-only auto-approval policy", () => {
    const supervisedDefault = evaluateToolPolicy(
      agent("supervised"),
      "read",
      { path: "README.md" },
      { dataDir: "/tmp/nerve" },
    );
    assert.equal(supervisedDefault.decision, "allow");
    assert.equal(supervisedDefault.risk, "read");

    const supervisedStrict = evaluateToolPolicy(
      agent("supervised", "coding", { autoApproveReadOnly: false }),
      "grep",
      { pattern: "todo", path: "." },
      { dataDir: "/tmp/nerve" },
    );
    assert.equal(supervisedStrict.decision, "approval");
    assert.equal(supervisedStrict.risk, "read");
    assert.match(
      supervisedStrict.reason,
      /auto-approve read-only tools is disabled/,
    );

    const readOnlyStrict = evaluateToolPolicy(
      agent("read_only", "coding", { autoApproveReadOnly: false }),
      "find",
      { pattern: "**/*.ts" },
      { dataDir: "/tmp/nerve" },
    );
    assert.equal(readOnlyStrict.decision, "allow");

    const mutatingStrict = evaluateToolPolicy(
      agent("supervised", "coding", { autoApproveReadOnly: false }),
      "edit",
      {
        path: "src/app.ts",
        lineInsertions: [{ line: 1, position: "after", text: "ok" }],
      },
      { dataDir: "/tmp/nerve" },
    );
    assert.equal(mutatingStrict.decision, "approval");
    assert.equal(mutatingStrict.risk, "workspace_write");
  });

  it("classifies web tools as network with normal permission handling", () => {
    assert.equal(
      evaluateToolPolicy(
        agent("autonomous"),
        "web_search",
        { query: "docs" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "allow",
    );
    assert.equal(
      evaluateToolPolicy(
        agent("supervised"),
        "web_fetch",
        { url: "https://example.test" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "approval",
    );
    assert.equal(
      evaluateToolPolicy(
        agent("read_only"),
        "web_search",
        { query: "docs" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "deny",
    );
  });

  it("auto-approves audited Jira and Confluence read-only network tools", () => {
    const readOnlyNetworkTools: {
      toolName: ToolName;
      args: Record<string, unknown>;
    }[] = [
      { toolName: "jira_search_users", args: { query: "alex" } },
      { toolName: "jira_search_issues", args: { jql: "project = PROJ" } },
      { toolName: "jira_get_issue", args: { issue_key: "PROJ-1" } },
      { toolName: "jira_get_project", args: { project_key: "PROJ" } },
      { toolName: "confluence_search_spaces", args: { query: "docs" } },
      { toolName: "confluence_search_pages", args: { cql: "type = page" } },
      { toolName: "confluence_get_page", args: { page_id: "123" } },
      { toolName: "confluence_download_pages", args: { page_id: "123" } },
    ];

    for (const { toolName, args } of readOnlyNetworkTools) {
      const supervisedDefault = evaluateToolPolicy(
        agent("supervised"),
        toolName,
        args,
        { dataDir: "/tmp/nerve" },
      );
      assert.equal(supervisedDefault.decision, "allow", toolName);
      assert.equal(supervisedDefault.risk, "network", toolName);

      const supervisedStrict = evaluateToolPolicy(
        agent("supervised", "coding", { autoApproveReadOnly: false }),
        toolName,
        args,
        { dataDir: "/tmp/nerve" },
      );
      assert.equal(supervisedStrict.decision, "approval", toolName);
      assert.equal(supervisedStrict.risk, "network", toolName);
      assert.match(
        supervisedStrict.reason,
        /auto-approve read-only tools is disabled/,
        toolName,
      );

      const readOnlyAgent = evaluateToolPolicy(
        agent("read_only"),
        toolName,
        args,
        { dataDir: "/tmp/nerve" },
      );
      assert.equal(readOnlyAgent.decision, "deny", toolName);
      assert.equal(readOnlyAgent.risk, "network", toolName);

      const planningSupervisedDefault = evaluateToolPolicy(
        agent("supervised", "planning"),
        toolName,
        args,
        { dataDir: "/tmp/nerve" },
      );
      assert.equal(planningSupervisedDefault.decision, "allow", toolName);
      assert.equal(planningSupervisedDefault.risk, "network", toolName);

      const planningSupervisedStrict = evaluateToolPolicy(
        agent("supervised", "planning", { autoApproveReadOnly: false }),
        toolName,
        args,
        { dataDir: "/tmp/nerve" },
      );
      assert.equal(planningSupervisedStrict.decision, "approval", toolName);
      assert.match(
        planningSupervisedStrict.reason,
        /auto-approve read-only tools is disabled/,
        toolName,
      );
    }
  });

  it("allows network research in planning mode with permission checks", () => {
    assert.equal(
      evaluateToolPolicy(
        agent("autonomous", "planning"),
        "web_search",
        { query: "current docs" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "allow",
    );
    assert.equal(
      evaluateToolPolicy(
        agent("supervised", "planning"),
        "web_fetch",
        { url: "https://example.test" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "approval",
    );
  });

  it("classifies Jira and Confluence tools with planning-mode behavior", () => {
    assert.equal(
      evaluateToolPolicy(
        agent("autonomous"),
        "jira_search_issues",
        { jql: "project = PROJ" },
        { dataDir: "/tmp/nerve" },
      ).risk,
      "network",
    );
    assert.equal(
      evaluateToolPolicy(
        agent("autonomous"),
        "jira_create_issue",
        { issue_type: "Task", summary: "Test" },
        { dataDir: "/tmp/nerve" },
      ).risk,
      "command",
    );
    assert.equal(
      evaluateToolPolicy(
        agent("autonomous", "planning"),
        "jira_get_issue",
        { issue_key: "PROJ-1" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "allow",
    );
    assert.equal(
      evaluateToolPolicy(
        agent("autonomous", "planning"),
        "jira_transition_issue",
        { issue_key: "PROJ-1", transition: "Done" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "deny",
    );
    assert.equal(
      evaluateToolPolicy(
        agent("autonomous"),
        "confluence_search_pages",
        { cql: "type = page" },
        { dataDir: "/tmp/nerve" },
      ).risk,
      "network",
    );
    assert.equal(
      evaluateToolPolicy(
        agent("autonomous"),
        "confluence_update_page",
        { page_id: "123", body: "<p>Test</p>" },
        { dataDir: "/tmp/nerve" },
      ).risk,
      "command",
    );
    assert.equal(
      evaluateToolPolicy(
        agent("autonomous", "planning"),
        "confluence_get_page",
        { page_id: "123" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "allow",
    );
    assert.equal(
      evaluateToolPolicy(
        agent("autonomous", "planning"),
        "confluence_publish_pages",
        { input_path: "/tmp/pages.jsonl" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "deny",
    );
  });

  it("handles python_exec as a command tool with planning-mode guardrails", () => {
    assert.equal(
      evaluateToolPolicy(
        agent("autonomous"),
        "python_exec",
        { code: "print('ok')" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "allow",
    );
    assert.equal(
      evaluateToolPolicy(
        agent("supervised"),
        "python_exec",
        { code: "print('ok')" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "approval",
    );
    assert.equal(
      evaluateToolPolicy(
        agent("read_only"),
        "python_exec",
        { code: "print('ok')" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "deny",
    );
    const planning = evaluateToolPolicy(
      agent("autonomous", "planning"),
      "python_exec",
      { code: "print('ok')" },
      { dataDir: "/tmp/nerve" },
    );
    assert.equal(planning.decision, "allow");
    assert.match(planning.reason, /file-write guardrails/);
    assert.equal(
      evaluateToolPolicy(
        agent("supervised", "planning"),
        "python_exec",
        { code: "print('ok')" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "approval",
    );
  });
  it("applies planning-mode plan-file guardrails to edit tools", () => {
    const allowed = evaluateToolPolicy(
      agent("autonomous", "planning"),
      "edit",
      {
        path: "/tmp/nerve/plans/edit-plan.md",
        lineInsertions: [{ line: 1, position: "after", text: "ok" }],
      },
      { dataDir: "/tmp/nerve" },
    );
    assert.equal(allowed.decision, "allow");
    assert.equal(allowed.normalizedArgs.path, "/tmp/nerve/plans/edit-plan.md");

    const denied = evaluateToolPolicy(
      agent("autonomous", "planning"),
      "edit",
      {
        path: "src/app.ts",
        lineInsertions: [{ line: 1, position: "after", text: "ok" }],
      },
      { dataDir: "/tmp/nerve" },
    );
    assert.equal(denied.decision, "deny");
    assert.match(denied.reason, /Planning mode allows edit only/);
  });

  it("handles explore as a bounded agent-spawn tool", () => {
    assert.equal(
      evaluateToolPolicy(
        agent("autonomous"),
        "explore",
        {
          tasks: [{ task: "Map the API architecture in detail." }],
          context: "Parent lookup identified the API entry points for review.",
        },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "allow",
    );
    assert.equal(
      evaluateToolPolicy(
        agent("supervised"),
        "explore",
        {
          tasks: [{ task: "Map the API architecture in detail." }],
          context: "Parent lookup identified the API entry points for review.",
        },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "approval",
    );
    assert.equal(
      evaluateToolPolicy(
        agent("read_only"),
        "explore",
        {
          tasks: [{ task: "Map the API architecture in detail." }],
          context: "Parent lookup identified the API entry points for review.",
        },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "deny",
    );
    assert.equal(
      evaluateToolPolicy(
        agent("autonomous", "planning"),
        "explore",
        {
          tasks: [{ task: "Map the API architecture in detail." }],
          context: "Parent lookup identified the API entry points for review.",
        },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "allow",
    );
  });

  it("uses a blacklist guard for planning-mode bash commands", () => {
    const autonomousSafe = evaluateToolPolicy(
      agent("autonomous", "planning"),
      "bash",
      { command: "pnpm check" },
      { dataDir: "/tmp/nerve" },
    );
    assert.equal(autonomousSafe.decision, "allow");
    assert.equal(autonomousSafe.risk, "command");
    assert.match(autonomousSafe.reason, /blacklist guard/);

    const supervisedSafe = evaluateToolPolicy(
      agent("supervised", "planning"),
      "bash",
      { command: "oxfmt --check . && eslint . && tsc --noEmit" },
      { dataDir: "/tmp/nerve" },
    );
    assert.equal(supervisedSafe.decision, "approval");
    assert.equal(supervisedSafe.risk, "command");

    assert.equal(
      evaluateToolPolicy(
        agent("read_only", "planning"),
        "bash",
        { command: "pnpm check" },
        { dataDir: "/tmp/nerve" },
      ).decision,
      "deny",
    );

    const supervisedReadOnlyCommand = evaluateToolPolicy(
      agent("supervised", "planning"),
      "bash",
      { command: "git status --short" },
      { dataDir: "/tmp/nerve" },
    );
    assert.equal(supervisedReadOnlyCommand.decision, "allow");
    assert.equal(supervisedReadOnlyCommand.risk, "read");

    const supervisedStrictReadOnlyCommand = evaluateToolPolicy(
      agent("supervised", "planning", { autoApproveReadOnly: false }),
      "bash",
      { command: "git status --short" },
      { dataDir: "/tmp/nerve" },
    );
    assert.equal(supervisedStrictReadOnlyCommand.decision, "approval");
    assert.equal(supervisedStrictReadOnlyCommand.risk, "read");

    for (const command of [
      "find . -delete",
      "rm -rf dist",
      "pnpm install",
      "pnpm run dev",
      "echo hello > file.txt",
    ]) {
      assert.equal(
        evaluateToolPolicy(
          agent("autonomous", "planning"),
          "bash",
          { command },
          { dataDir: "/tmp/nerve" },
        ).decision,
        "deny",
        command,
      );
    }
  });
});
