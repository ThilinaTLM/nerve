import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parsePromptResult,
  parseStatusDetail,
  parseStatusListing,
  parseStopResult,
  parseSubagentNotice,
  subagentAssignments,
} from "./subagent-result-parser";
import { findSubagent, subagentLiveState } from "./subagent-live";

describe("subagent_prompt result", () => {
  const result = [
    "auth-research (explore): created",
    "refresh-fix (developer): follow-up queued (running)",
  ].join("\n");

  it("reads one line per assignment", () => {
    assert.deepEqual(parsePromptResult(result), [
      { name: "auth-research", profile: "explore", disposition: "created" },
      {
        name: "refresh-fix",
        profile: "developer",
        disposition: "follow_up",
        queuedState: "running",
      },
    ]);
  });

  it("joins result lines to the call's assignments by name", () => {
    const assignments = subagentAssignments(
      {
        context: "shared",
        assignments: [
          { name: "auth-research", profile: "explore", prompt: "Look" },
          { name: "Refresh-Fix", prompt: "Fix" },
          { prompt: "nameless" },
        ],
      },
      result,
    );
    assert.equal(assignments.length, 2);
    assert.equal(assignments[0].disposition, "created");
    assert.equal(assignments[1].profile, "developer");
    assert.equal(assignments[1].queuedState, "running");
  });

  it("keeps assignments while the call is unsettled or failed", () => {
    const assignments = subagentAssignments(
      { assignments: [{ name: "a", profile: "explore", prompt: "x" }] },
      "No sub-agents were created:\n- a: unknown profile",
    );
    assert.deepEqual(assignments, [
      {
        name: "a",
        profile: "explore",
        prompt: "x",
        disposition: undefined,
        queuedState: undefined,
      },
    ]);
  });
});

describe("subagent_status result", () => {
  it("parses the listing, including waiting reasons", () => {
    const rows = parseStatusListing(
      [
        "auth-research · explore · running · ctx 34% · active 20s ago",
        "refresh-fix · developer · waiting: 1 background command · ctx 51% · 1m ago",
        "not a row",
      ].join("\n"),
    );
    assert.deepEqual(rows, [
      {
        name: "auth-research",
        profile: "explore",
        state: "running",
        context: "34%",
        activity: "active 20s ago",
      },
      {
        name: "refresh-fix",
        profile: "developer",
        state: "waiting: 1 background command",
        context: "51%",
        activity: "1m ago",
      },
    ]);
  });

  it("splits a single sub-agent's answer into header and body", () => {
    assert.deepEqual(
      parseStatusDetail("a · explore · idle\nFinal response:\nDone"),
      {
        header: "a · explore · idle",
        body: "Final response:\nDone",
      },
    );
    assert.deepEqual(parseStatusDetail("a · explore · idle"), {
      header: "a · explore · idle",
    });
    assert.deepEqual(parseStatusDetail(undefined), {});
  });
});

describe("subagent_stop result", () => {
  it("reads one line per name", () => {
    assert.deepEqual(parseStopResult("a: stopped\nb: was not running"), [
      { name: "a", outcome: "stopped" },
      { name: "b", outcome: "was not running" },
    ]);
  });
});

describe("sub_conversation_event notice", () => {
  it("reads a completed notice with its response", () => {
    assert.deepEqual(
      parseSubagentNotice(
        'Sub-agent "auth" (explore) completed.\nSummary\nAll good',
      ),
      {
        name: "auth",
        profile: "explore",
        outcome: "completed",
        detail: undefined,
        response: "Summary\nAll good",
        reportPath: undefined,
      },
    );
  });

  it("reads failures, stops and legacy notices without a profile", () => {
    const failed = parseSubagentNotice(
      'Sub-agent "x" (developer) failed: boom\nlast words',
    );
    assert.equal(failed?.outcome, "failed");
    assert.equal(failed?.detail, "boom");
    assert.equal(failed?.response, "last words");
    assert.equal(
      parseSubagentNotice('Sub-agent "x" (developer) was stopped by the user.')
        ?.outcome,
      "stopped",
    );
    const legacy = parseSubagentNotice('Sub-agent "x" interrupted.');
    assert.equal(legacy?.outcome, "interrupted");
    assert.equal(legacy?.profile, undefined);
  });

  it("separates waiting commands from the response", () => {
    const notice = parseSubagentNotice(
      [
        'Sub-agent "x" (developer) is waiting on 1 background command and accepts follow-ups:',
        '"pnpm test" running 3m',
        "Provisional answer",
      ].join("\n"),
    );
    assert.equal(notice?.outcome, "waiting");
    assert.equal(notice?.detail, '"pnpm test" running 3m');
    assert.equal(notice?.response, "Provisional answer");
  });

  it("extracts the report path of a truncated response", () => {
    const notice = parseSubagentNotice(
      'Sub-agent "x" (explore) completed.\nlong text\n[truncated; full response: /data/conversations/c/reports/e.md]',
    );
    assert.equal(notice?.response, "long text");
    assert.equal(notice?.reportPath, "/data/conversations/c/reports/e.md");
  });

  it("ignores other text", () => {
    assert.equal(parseSubagentNotice("Background command finished"), undefined);
    assert.equal(parseSubagentNotice(undefined), undefined);
  });
});

describe("live sub-agent state", () => {
  it("finds children by assignment name regardless of case", () => {
    const agents = [
      { id: "c1", name: "Auth-Research", status: "running" as const },
    ];
    assert.equal(findSubagent(agents, "auth-research")?.id, "c1");
    assert.equal(findSubagent(agents, "other"), undefined);
  });

  it("labels each status", () => {
    assert.equal(subagentLiveState("running").label, "working");
    assert.equal(subagentLiveState("waiting").label, "needs you");
    assert.equal(subagentLiveState("idle").tone, "neutral");
    assert.equal(subagentLiveState("failed").tone, "destructive");
  });
});
