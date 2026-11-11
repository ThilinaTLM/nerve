import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createQuickScriptAuthorizer,
  type QuickScriptCall,
} from "./quick-script-broker.js";

type Decision = "allow" | "deny" | "approval" | "stale" | "blocked";

function authorizer(decisions: Decision[]) {
  const inputs: Array<{ toolName: string; args: unknown; target: unknown }> =
    [];
  const authorize = createQuickScriptAuthorizer(async (input) => {
    inputs.push(input);
    const next = decisions.shift() ?? "allow";
    return {
      check: () =>
        next === "stale"
          ? { kind: "stale" as const }
          : next === "blocked"
            ? { kind: "blocked" as const, request: { diagnostics: [] } }
            : ({
                kind: "policy" as const,
                supervision: {
                  decision: next,
                  reason: next === "allow" ? undefined : "read-only mode",
                  suggestedRules: [],
                  authority: {},
                },
                evidence: {},
              } as never),
    };
  });
  return { authorize, inputs };
}

const call: QuickScriptCall = {
  toolCallId: "tool_1",
  conversationId: "conv_1",
  projectDir: "/p",
  origin: "model",
  cwd: "/p",
  signal: new AbortController().signal,
  admission: { by: "user" as const, scriptRisk: "read" },
};

void test("nested calls are evaluated as the equivalent direct tool call", async () => {
  const { authorize, inputs } = authorizer(["stale", "allow"]);
  await authorize(call, {
    toolName: "jira_search_issues",
    args: { jql: "project = X" },
  });
  assert.equal(inputs.length, 2);
  assert.equal(inputs[1]?.toolName, "jira_search_issues");
  assert.deepEqual(inputs[1]?.args, { jql: "project = X" });
});

void test("deny refuses the call with the policy reason", async () => {
  const { authorize } = authorizer(["deny"]);
  await assert.rejects(
    authorize(call, { toolName: "jira_get_issue", args: {} }),
    {
      code: "NESTED_DENIED",
      message: "jira_get_issue: denied (read-only mode)",
    },
  );
});

void test("approval inside the approved risk runs; above it is refused", async () => {
  const { authorize } = authorizer(["approval", "approval", "approval"]);
  await authorize(call, { toolName: "jira_get_issue", args: {} });
  await assert.rejects(
    authorize(call, { toolName: "jira_create_issue", args: {} }),
    {
      code: "NESTED_APPROVAL_REQUIRED",
      message:
        "jira_create_issue: script was approved for read operations; this call needs write approval (read-only mode)",
    },
  );
  await authorize(
    {
      ...call,
      admission: { by: "user" as const, scriptRisk: "workspace_write" },
    },
    { toolName: "jira_create_issue", args: {} },
  );
});

void test("deny wins over the approved risk", async () => {
  const { authorize } = authorizer(["deny"]);
  await assert.rejects(
    authorize(
      {
        ...call,
        admission: { by: "user" as const, scriptRisk: "destructive" },
      },
      { toolName: "jira_get_issue", args: {} },
    ),
    { code: "NESTED_DENIED" },
  );
});

void test("only Atlassian, read and diagram tools can be brokered", async () => {
  const { authorize, inputs } = authorizer([]);
  for (const toolName of ["bash", "write", "web_fetch"])
    await assert.rejects(authorize(call, { toolName, args: {} }), {
      code: "NESTED_DENIED",
    });
  assert.equal(inputs.length, 0);
  await authorize(call, { toolName: "read", args: { path: "chart.png" } });
  await authorize(call, { toolName: "kroki_export", args: {} });
  assert.deepEqual(
    inputs.map((input) => input.toolName),
    ["read", "kroki_export"],
  );
});

void test("the ceiling uses the nested call's own risk: adding is a write, deleting is destructive", async () => {
  const { authorize } = authorizer(["approval", "approval", "approval"]);
  const write = {
    ...call,
    admission: { by: "user" as const, scriptRisk: "workspace_write" as const },
  };
  await authorize(write, {
    toolName: "confluence_manage_comment",
    args: { action: "create", kind: "footer", page_id: "1", body: "hi" },
  });
  await assert.rejects(
    authorize(write, {
      toolName: "confluence_manage_comment",
      args: { action: "delete", comment_id: "9" },
    }),
    {
      code: "NESTED_APPROVAL_REQUIRED",
      message:
        "confluence_manage_comment: script was approved for write operations; this call needs destructive approval (read-only mode)",
    },
  );
  await authorize(
    { ...call, admission: { by: "user" as const, scriptRisk: "destructive" } },
    {
      toolName: "jira_manage_comment",
      args: { action: "delete", issue_key: "A-1", comment_id: "9" },
    },
  );
});

void test("a script allowed by a rule has no ceiling: a nested approval is refused", async () => {
  const { authorize } = authorizer(["approval"]);
  await assert.rejects(
    authorize(
      { ...call, admission: { by: "rule" as const, scriptRisk: "read" } },
      { toolName: "jira_get_issue", args: {} },
    ),
    {
      code: "NESTED_APPROVAL_REQUIRED",
      message:
        "jira_get_issue: needs read approval, but the script was allowed by a rule rather than approved (read-only mode)",
    },
  );
});

void test("a rule-allowed script still runs nested calls that policy allows and refuses denied ones", async () => {
  const { authorize } = authorizer(["allow", "deny"]);
  const allowed = {
    ...call,
    admission: { by: "rule" as const, scriptRisk: "read" as const },
  };
  await authorize(allowed, { toolName: "jira_get_issue", args: {} });
  await assert.rejects(
    authorize(allowed, { toolName: "jira_get_issue", args: {} }),
    { code: "NESTED_DENIED" },
  );
});

void test("an unanalysable call is never admitted by an allow rule", async () => {
  const raw = {
    toolName: "jira_manage_comment",
    args: { action: "delete", issue_key: "raw-request", comment_id: "-" },
    approvalRequired: true,
  };
  // Allowed by a rule for the borrowed tool, but the script was only allowed.
  await assert.rejects(
    authorizer(["allow"]).authorize(
      { ...call, admission: { by: "rule" as const, scriptRisk: "read" } },
      raw,
    ),
    { code: "NESTED_APPROVAL_REQUIRED" },
  );
  // A person approved the script below destructive level.
  await assert.rejects(
    authorizer(["allow"]).authorize(
      {
        ...call,
        admission: { by: "user" as const, scriptRisk: "workspace_write" },
      },
      raw,
    ),
    { code: "NESTED_APPROVAL_REQUIRED" },
  );
  // Approved at destructive level.
  await authorizer(["allow"]).authorize(
    { ...call, admission: { by: "user" as const, scriptRisk: "destructive" } },
    raw,
  );
  // Deny rules still win.
  await assert.rejects(
    authorizer(["deny"]).authorize(
      {
        ...call,
        admission: { by: "user" as const, scriptRisk: "destructive" },
      },
      raw,
    ),
    { code: "NESTED_DENIED" },
  );
});

void test("a rule-admitted destructive script runs a raw write only when the verdict allows it", async () => {
  const raw = {
    toolName: "jira_manage_comment",
    args: { action: "delete", issue_key: "raw-request", comment_id: "-" },
    approvalRequired: true,
  };
  const ruled = (scriptRisk: "destructive" | "workspace_write") => ({
    ...call,
    admission: { by: "rule" as const, scriptRisk },
  });
  await authorizer(["allow"]).authorize(ruled("destructive"), raw);
  await assert.rejects(
    authorizer(["approval"]).authorize(ruled("destructive"), raw),
    { code: "NESTED_APPROVAL_REQUIRED", message: /person approve the script/ },
  );
  await assert.rejects(
    authorizer(["allow"]).authorize(ruled("workspace_write"), raw),
    { code: "NESTED_APPROVAL_REQUIRED" },
  );
  await assert.rejects(
    authorizer(["deny"]).authorize(ruled("destructive"), raw),
    { code: "NESTED_DENIED" },
  );
});
