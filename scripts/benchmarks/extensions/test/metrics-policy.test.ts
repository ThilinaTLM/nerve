import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeEvents, type BenchEvent } from "../metrics.ts";
import { decideApproval } from "../policy.ts";
import { renderSummary, toolSurfaceTokens } from "../report.ts";
import { estimate } from "../commands.ts";
import { TASKS, validateTasks } from "../tasks.ts";

const sandbox = { jiraProject: "SCRUM", confluenceSpace: "SD" };

function assistant(
  sequence: number,
  usage: { input: number; cacheRead?: number; output: number },
  content: unknown[] = [],
): BenchEvent {
  return {
    id: `a${sequence}`,
    sequence,
    type: "assistant_message",
    payload: {
      content,
      usage: {
        cacheRead: 0,
        cacheWrite: 0,
        ...usage,
        totalTokens: usage.input + (usage.cacheRead ?? 0) + usage.output,
      },
    },
  };
}

function call(
  sequence: number,
  assistantEventId: string,
  toolName: string,
  args: unknown,
  outcome: string,
  text = "",
  supervision: unknown = null,
): BenchEvent {
  return {
    id: `t${sequence}`,
    sequence,
    type: "tool_call_response",
    payload: {
      origin: "model",
      toolName,
      arguments: args,
      outcome,
      assistantEventId,
      supervision,
      agentProjection: [{ type: "text", text }],
    },
  };
}

test("metrics: tokens before the first successful SDK call, failure classes, approvals", () => {
  const events = [
    assistant(1, { input: 1000, output: 50 }),
    call(2, "a1", "quick_script", { code: "sdk.help()" }, "completed"),
    assistant(3, { input: 1500, cacheRead: 500, output: 80 }),
    call(
      4,
      "a3",
      "quick_script",
      { code: "jira.issues.serch({})" },
      "failed",
      "Unknown method 'jira.issues.serch'. Valid methods: …",
    ),
    assistant(5, { input: 2500, output: 90 }),
    call(
      6,
      "a5",
      "quick_script",
      { code: "confluence.pages.get({})" },
      "failed",
      "confluence: not available in quick_script.",
    ),
    assistant(7, { input: 3000, output: 90 }),
    call(
      8,
      "a7",
      "jira_get_issue",
      { key: "SCRUM-1" },
      "failed",
      "no such tool",
    ),
    assistant(9, { input: 3500, output: 90 }),
    call(
      10,
      "a9",
      "quick_script",
      { code: "await jira.issues.update({ key: 'SCRUM-1' })" },
      "completed",
      "ok",
      { decision: "approval" },
    ),
  ];
  const metrics = analyzeEvents("quick_script", events);
  assert.equal(metrics.turns, 5);
  assert.equal(metrics.discoveryCalls, 1);
  assert.equal(metrics.failedWrongArguments, 1);
  assert.equal(metrics.unavailableNamespaceCalls, 2);
  assert.equal(metrics.approvalsRequested, 1);
  assert.equal(metrics.firstRequestInputTokens, 1000);
  assert.equal(metrics.requestsBeforeFirstSdkSuccess, 5);
  assert.equal(
    metrics.tokensBeforeFirstSdkSuccess,
    1000 + 2000 + 2500 + 3000 + 3500,
  );
});

test("approval policy stays inside the sandbox and the task's fixtures", () => {
  const scope = { issueKeys: ["SCRUM-12"] };
  const decide = (toolName: string, args: unknown, s = scope) =>
    decideApproval({ toolName, arguments: args }, s, sandbox).decision;
  assert.equal(
    decide("jira_update_issue", { issueKey: "SCRUM-12" }),
    "approve",
  );
  assert.equal(decide("jira_update_issue", { issueKey: "SCRUM-13" }), "deny");
  assert.equal(decide("jira_update_issue", { issueKey: "OPS-1" }), "deny");
  assert.equal(
    decide("confluence_update_page", { spaceKey: "ENG", pageId: "1234" }, {}),
    "deny",
  );
  assert.equal(
    decide("quick_script", {
      code: "await jira.issues.delete({key:'SCRUM-12'})",
    }),
    "deny",
  );
  assert.equal(decide("bash", { command: "ls" }), "deny");
  assert.equal(
    decide("python_exec", { code: "1" }, { allowShell: true }),
    "approve",
  );
  assert.equal(
    decide(
      "confluence_update_page",
      { pageId: "99999" },
      { pageIds: ["12345"] },
    ),
    "deny",
  );
});

test("task file is valid and the report compares variants per family", () => {
  assert.deepEqual(validateTasks(TASKS), []);
  assert.equal(estimate(TASKS, 2, 2, 5).runs, TASKS.length * 20);
  const probes = [
    {
      model: "m",
      family: "Claude",
      variant: "none" as const,
      firstRequestInputTokens: 3000,
    },
    {
      model: "m",
      family: "Claude",
      variant: "direct" as const,
      firstRequestInputTokens: 9000,
    },
  ];
  assert.equal(toolSurfaceTokens(probes, "m", "direct"), 6000);
  const record = (
    variant: "direct" | "quick_script",
    status: "passed" | "failed",
  ) => ({
    task: "t",
    model: "m",
    family: "Claude",
    variant,
    run: 1,
    status,
    failures: [],
    durationMs: 1,
    approvalsApproved: 0,
    approvalsDenied: 0,
    questionsDismissed: 0,
  });
  const markdown = renderSummary(
    [record("direct", "passed"), record("quick_script", "failed")],
    probes,
    { slot: 5, ruleSet: "supervised", generatedAt: "now" },
  );
  assert.match(markdown, /### Claude/);
  assert.match(markdown, /direct wins clearly/);
});
