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

const op = (
  operation: string,
  risk: "network" | "external_write" | "destructive",
  targets: string[] = [],
) => ({ operation, targets, risk });

const as = (
  by: "user" | "rule",
  scriptRisk: QuickScriptCall["admission"]["scriptRisk"],
): QuickScriptCall => ({ ...call, admission: { by, scriptRisk } });

void test("an operation is evaluated as a quick_script request with operation, targets and risk", async () => {
  const { authorize, inputs } = authorizer(["stale", "allow"]);
  await authorize(call, op("jira.issues.get", "network", ["jira:issue/APP-1"]));
  assert.equal(inputs.length, 2);
  assert.equal(inputs[1]?.toolName, "quick_script");
  assert.deepEqual(inputs[1]?.args, {
    operation: "jira.issues.get",
    targets: ["jira:issue/APP-1"],
    risk: "network",
  });
  assert.equal(
    (inputs[1]?.target as { kind: string }).kind,
    "quick_script_nested",
  );
});

void test("any operation of a registered namespace is accepted; unknown namespaces are refused", async () => {
  const { authorize, inputs } = authorizer([]);
  for (const operation of [
    "jira.issues.create",
    "confluence.pages.update",
    "diagram.render",
    "jira.request",
  ])
    await authorize(call, op(operation, "network"));
  assert.equal(inputs.length, 4);
  await assert.rejects(authorize(call, op("bash.run", "network")), {
    code: "NESTED_DENIED",
  });
  assert.equal(inputs.length, 4);
});

void test("deny refuses the call with the operation, targets and policy reason", async () => {
  const { authorize } = authorizer(["deny"]);
  await assert.rejects(
    authorize(call, op("jira.issues.get", "network", ["jira:issue/APP-1"])),
    {
      code: "NESTED_DENIED",
      message: "jira.issues.get · jira:issue/APP-1: denied (read-only mode)",
    },
  );
});

void test("approval inside the approved risk runs; above it is refused", async () => {
  const { authorize } = authorizer(["approval", "approval", "approval"]);
  await assert.rejects(authorize(call, op("jira.issues.get", "network")), {
    code: "NESTED_APPROVAL_REQUIRED",
    message: /approved for read/,
  });
  await authorize(as("user", "network"), op("jira.issues.get", "network"));
  await assert.rejects(
    authorize(
      as("user", "network"),
      op("jira.issues.create", "external_write", ["jira:project/APP"]),
    ),
    {
      code: "NESTED_APPROVAL_REQUIRED",
      message:
        "jira.issues.create · jira:project/APP: script was approved for network operations; this call needs external write approval (read-only mode)",
    },
  );
});

void test("a workspace_write ceiling admits Atlassian (external) writes: equal rank", async () => {
  const { authorize } = authorizer(["approval"]);
  await authorize(
    as("user", "workspace_write"),
    op("jira.issues.create", "external_write"),
  );
});

void test("deny wins over the approved risk", async () => {
  const { authorize } = authorizer(["deny"]);
  await assert.rejects(
    authorize(as("user", "destructive"), op("jira.issues.get", "network")),
    { code: "NESTED_DENIED" },
  );
});

void test("only operations and the remaining direct tools can be brokered", async () => {
  const { authorize, inputs } = authorizer([]);
  for (const toolName of [
    "bash",
    "python_exec",
    "jira_get_issue",
    "kroki_export",
  ])
    await assert.rejects(authorize(call, { toolName, args: {} }), {
      code: "NESTED_DENIED",
    });
  assert.equal(inputs.length, 0);
  await authorize(call, { toolName: "read", args: { path: "chart.png" } });
  await authorize(call, {
    toolName: "write",
    args: { path: "a.txt", content: "" },
  });
  await authorize(call, {
    toolName: "edit",
    args: { path: "a.txt", edits: [] },
  });
  await authorize(call, {
    toolName: "web_fetch",
    args: { url: "https://example.com" },
  });
  await authorize(call, { toolName: "web_search", args: { query: "x" } });
  assert.deepEqual(
    inputs.map((input) => input.toolName),
    ["read", "write", "edit", "web_fetch", "web_search"],
  );
});

void test("the ceiling uses the operation's own risk: adding is a write, deleting is destructive", async () => {
  const { authorize } = authorizer(["approval", "approval", "approval"]);
  const write = as("user", "workspace_write");
  await authorize(write, op("confluence.comments.add", "external_write"));
  await assert.rejects(
    authorize(
      write,
      op("confluence.comments.delete", "destructive", ["confluence:comment/9"]),
    ),
    {
      code: "NESTED_APPROVAL_REQUIRED",
      message:
        "confluence.comments.delete · confluence:comment/9: script was approved for workspace write operations; this call needs destructive approval (read-only mode)",
    },
  );
  await authorize(
    as("user", "destructive"),
    op("jira.comments.delete", "destructive"),
  );
});

void test("a script approved at network level runs nested network calls but not writes", async () => {
  const approved = as("user", "network");
  const { authorize } = authorizer(["approval", "approval", "approval"]);
  await authorize(approved, { toolName: "web_fetch", args: {} });
  await authorize(approved, op("jira.issues.get", "network"));
  await assert.rejects(
    authorize(approved, op("jira.comments.add", "external_write")),
    { code: "NESTED_APPROVAL_REQUIRED", message: /approved for network/ },
  );
});

void test("a script allowed by a rule has no ceiling: a nested approval is refused", async () => {
  const { authorize } = authorizer(["approval"]);
  await assert.rejects(
    authorize(as("rule", "read"), op("jira.issues.get", "network")),
    {
      code: "NESTED_APPROVAL_REQUIRED",
      message:
        "jira.issues.get: needs network approval, but the script was allowed by a rule rather than approved (read-only mode)",
    },
  );
});

void test("a rule-allowed script still runs nested calls that policy allows and refuses denied ones", async () => {
  const { authorize } = authorizer(["allow", "deny"]);
  const allowed = as("rule", "read");
  await authorize(allowed, op("jira.issues.get", "network"));
  await assert.rejects(authorize(allowed, op("jira.issues.get", "network")), {
    code: "NESTED_DENIED",
  });
});

void test("a raw request is an ordinary destructive operation: an allow rule admits it, otherwise it needs a destructive approval", async () => {
  const raw = op("jira.request", "destructive", [
    "jira:request/DELETE /rest/api/3/issue/APP-1",
  ]);
  // A rule matching the method and path admits it.
  await authorizer(["allow"]).authorize(as("rule", "destructive"), raw);
  // No rule: a prompt verdict is refused for a rule-allowed script and for a lower approval.
  await assert.rejects(
    authorizer(["approval"]).authorize(as("rule", "destructive"), raw),
    { code: "NESTED_APPROVAL_REQUIRED" },
  );
  await assert.rejects(
    authorizer(["approval"]).authorize(as("user", "workspace_write"), raw),
    { code: "NESTED_APPROVAL_REQUIRED" },
  );
  await authorizer(["approval"]).authorize(as("user", "destructive"), raw);
  await assert.rejects(
    authorizer(["deny"]).authorize(as("user", "destructive"), raw),
    {
      code: "NESTED_DENIED",
    },
  );
});
