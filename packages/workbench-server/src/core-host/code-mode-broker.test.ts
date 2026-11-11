import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCodeModeAuthorizer,
  type CodeModeCall,
} from "./code-mode-broker.js";

type Decision = "allow" | "deny" | "approval" | "stale" | "blocked";

function authorizer(decisions: Decision[]) {
  const inputs: Array<{ toolName: string; args: unknown; target: unknown }> =
    [];
  const authorize = createCodeModeAuthorizer(async (input) => {
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

const call: CodeModeCall = {
  toolCallId: "tool_1",
  conversationId: "conv_1",
  projectDir: "/p",
  origin: "model",
  cwd: "/p",
  signal: new AbortController().signal,
  approvedRisk: "read",
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
    { ...call, approvedRisk: "workspace_write" },
    { toolName: "jira_create_issue", args: {} },
  );
});

void test("deny wins over the approved risk", async () => {
  const { authorize } = authorizer(["deny"]);
  await assert.rejects(
    authorize(
      { ...call, approvedRisk: "destructive" },
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
