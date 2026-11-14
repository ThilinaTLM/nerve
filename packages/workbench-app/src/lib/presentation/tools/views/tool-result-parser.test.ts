import { outcomeLabel } from "./tool-presentation-helpers";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolCallRecord } from "../../state/tool-types";
import { toolLifecycleSpec } from "../lifecycle/registry";
import {
  displayArtifactHandles,
  displayLinks,
  displayTable,
} from "./extension-display";
import { parseToolView, parseToolViewCached } from "./tool-result-parser";

function call(
  toolName: string,
  args: unknown,
  result: unknown,
): ToolCallRecord {
  return {
    id: "call",
    agentId: "agent",
    conversationId: "conversation",
    projectId: "project",
    toolName,
    args,
    result,
    cwd: "/workspace",
    status: "completed",
    revision: 1,
    attempt: 1,
    createdAt: "2026-10-12T00:00:00Z",
    updatedAt: "2026-10-12T00:00:00Z",
  };
}

describe("parseToolViewCached", () => {
  it("keys by payload identity without serializing results", () => {
    let serialized = 0;
    const result = {
      content: "output",
      toJSON() {
        serialized++;
        return {};
      },
    };
    const record = call("bash", { command: "true" }, result);
    const first = parseToolViewCached(record);
    assert.equal(parseToolViewCached({ ...record }), first);
    assert.equal(serialized, 0);
    assert.deepEqual(first, parseToolView(record));
    const other = call("bash", { command: "true" }, { content: "output" });
    assert.notEqual(parseToolViewCached(other), first);
  });
});

describe("Bash exit codes", () => {
  for (const toolName of ["bash", "async_bash", "launch"]) {
    for (const [label, result, expected] of [
      [
        "top-level success takes precedence",
        { exitCode: 0, details: { exitCode: 7 } },
        0,
      ],
      [
        "top-level failure takes precedence",
        { exitCode: 7, details: { exitCode: 0 } },
        7,
      ],
      ["details success", { details: { exitCode: 0 } }, 0],
      ["details failure", { details: { exitCode: 7 } }, 7],
      [
        "null details remain unknown",
        { details: { exitCode: null } },
        undefined,
      ],
      ["missing code remains unknown", { details: {} }, undefined],
      [
        "string code remains unknown",
        { details: { exitCode: "0" } },
        undefined,
      ],
    ] as const) {
      it(`${toolName}: ${label}`, () => {
        const view = parseToolView(
          call(toolName, { command: "true" }, { content: "output", ...result }),
        );
        assert.equal(view.kind, "bash");
        if (view.kind !== "bash") return;
        assert.equal(view.exitCode, expected);
      });
    }
  }
});

describe("recorded planning tools", () => {
  for (const toolName of ["plan_mode_enter", "plan_mode_force_exit"]) {
    it(`renders ${toolName} through the redacted generic fallback`, () => {
      const view = parseToolView(
        call(
          toolName,
          { reason: "Historical planning request", api_token: "private-token" },
          { reason: "Historical outcome", api_token: "private-result" },
        ),
      );
      assert.equal(view.kind, "generic");
      if (view.kind !== "generic") return;
      assert.equal(view.toolName, toolName);
      const serialized = JSON.stringify(view);
      assert.match(serialized, /Historical planning request/);
      assert.match(serialized, /Historical outcome/);
      assert.match(serialized, /\[redacted\]/);
      assert.doesNotMatch(serialized, /private-token|private-result/);
    });
  }

  it("reads the complete reviewed snapshot from stored result details", () => {
    const view = parseToolView(
      call(
        "plan_present",
        { file_path: "/workspace/plan.md" },
        {
          content: "Plan approved.",
          details: {
            decision: "approve",
            review: {
              id: "tool_plan",
              content: "# Reviewed plan",
              status: "accepted",
              planPath: "/snapshot/plan.md",
            },
          },
        },
      ),
    );
    assert.equal(view.kind, "plan_present");
    if (view.kind !== "plan_present") return;
    assert.equal(view.planPreview, "# Reviewed plan");
    assert.equal(view.outcome, "accepted");
    assert.equal(view.planPath, "/snapshot/plan.md");
  });

  it("keeps plan presentation and review data specialized", () => {
    const view = parseToolView(
      call(
        "plan_present",
        { file_path: "/workspace/plan.md" },
        {
          review: { content: "Implementation plan", status: "accepted" },
          feedback: "Approved",
        },
      ),
    );
    assert.deepEqual(view, {
      kind: "plan_present",
      action: "present",
      summary: "Approved",
      planPreview: "Implementation plan",
      planPath: "/workspace/plan.md",
      outcome: "accepted",
    });
  });
});

describe("structured lifecycle result details", () => {
  it("prefers subagent assignment dispositions, including rejections on failed calls", () => {
    const record = call(
      "subagent_prompt",
      { assignments: [{ name: "a", prompt: "Do it" }] },
      {
        content: "a (explore): created",
        details: {
          assignments: [
            {
              name: "a",
              disposition: "rejected",
              reason: "No capacity",
              agentId: "agent-a",
            },
          ],
        },
      },
    );
    record.status = "failed";
    const view = parseToolView(record);
    assert.equal(view.kind, "subagent");
    if (view.kind !== "subagent" || view.action !== "prompt") return;
    assert.equal(view.assignments[0].disposition, "rejected");
    assert.equal(view.assignments[0].reason, "No capacity");
    assert.equal(view.assignments[0].agentId, "agent-a");
  });
  it("prefers structured status and stop rows over legacy text", () => {
    const status = parseToolView(
      call(
        "subagent_status",
        {},
        {
          content: "a · explore · idle",
          details: {
            agents: [
              {
                name: "a",
                state: "running",
                agentId: "a-id",
                contextPercent: 42,
                lastActivityAt: "2026-10-12T00:00:00Z",
              },
            ],
          },
        },
      ),
    );
    assert.ok(status.kind === "subagent" && status.action === "status");
    assert.equal(status.rows[0].state, "running");
    assert.equal(status.rows[0].contextPercent, 42);
    const stop = parseToolView(
      call(
        "subagent_stop",
        { names: ["a"] },
        {
          content: "a: stopped",
          details: {
            results: [
              {
                name: "a",
                outcome: "failed",
                runMs: 100,
                reason: "Unavailable",
              },
            ],
          },
        },
      ),
    );
    assert.ok(stop.kind === "subagent" && stop.action === "stop");
    assert.deepEqual(stop.lines[0], {
      name: "a",
      outcome: "failed",
      runMs: 100,
      reason: "Unavailable",
    });
  });
  it("retains edit operation failures and applied count", () => {
    const view = parseToolView(
      call(
        "edit",
        { edits: [{ oldText: "a", newText: "b" }] },
        {
          details: {
            diff: "-a\n+b",
            operationCount: 1,
            appliedCount: 0,
            operations: [{ status: "failed", error: "No match" }],
          },
        },
      ),
    );
    assert.equal(view.kind, "edit");
    if (view.kind !== "edit") return;
    assert.equal(view.appliedCount, 0);
    assert.deepEqual(view.operations, [
      { index: 0, status: "failed", error: "No match" },
    ]);
  });
  it("prefers write bytes and outcome, falling back to legacy byte text", () => {
    const structured = parseToolView(
      call(
        "write",
        {},
        { content: "Wrote 4 bytes", details: { bytes: 9, outcome: "created" } },
      ),
    );
    assert.ok(structured.kind === "write");
    assert.equal(structured.bytes, 9);
    assert.equal(structured.outcome, "created");
    const legacy = parseToolView(
      call("write", {}, { content: "Wrote 4 bytes" }),
    );
    assert.ok(legacy.kind === "write");
    assert.equal(legacy.bytes, 4);
  });
  it("uses authoritative grep totals rather than the bounded visible matches", () => {
    const structured = parseToolView(
      call(
        "grep",
        {},
        {
          matches: [{ path: "a", line: 1, text: "hit" }],
          details: { totalMatches: 300, totalFiles: 20 },
        },
      ),
    );
    assert.ok(structured.kind === "grep");
    assert.equal(structured.matchCount, 300);
    assert.equal(structured.fileCount, 20);
    const legacy = parseToolView(
      call("grep", {}, { matches: [{ path: "a", line: 1, text: "hit" }] }),
    );
    assert.ok(legacy.kind === "grep");
    assert.equal(legacy.matchCount, 1);
  });
});

it("renders legacy edit diffs without structured operation status", () => {
  const view = parseToolView(
    call(
      "edit",
      { edits: [{ oldText: "a", newText: "b" }] },
      { details: { diff: "-a\n+b" } },
    ),
  );
  assert.ok(view.kind === "edit");
  assert.equal(view.operationCount, 1);
  assert.equal(view.diff, "-a\n+b");
  assert.equal(view.operations, undefined);
});

it("renders calls recorded by removed tools with the generic view", () => {
  for (const toolName of [
    "jira_search_issues",
    "confluence_get_page",
    "kroki_export",
    "generate_image",
  ]) {
    const view = parseToolView(
      call(
        toolName,
        { jql: "project = APP" },
        { content: "3 issues", details: { issues: [{ key: "APP-1" }] } },
      ),
    );
    assert.equal(view.kind, "generic", toolName);
    assert.equal(toolLifecycleSpec(toolName).completedView, "generic");
  }
});

describe("quick_script result", () => {
  it("lists the artifacts the run created", () => {
    const view = parseToolView(
      call(
        "quick_script",
        { code: "return 1" },
        {
          content: "1\nexit 0",
          details: {
            status: "completed",
            durationMs: 12,
            hostCalls: [],
            artifacts: [
              {
                handle: "artifact:flow.png",
                path: "/data/conversations/c/quick-script/flow.png",
                bytes: 2048,
                mediaType: "image/png",
                width: 760,
                height: 400,
              },
            ],
          },
        },
      ),
    );
    assert.equal(view.kind, "quick_script");
    if (view.kind !== "quick_script") return;
    assert.equal(view.artifacts[0]?.handle, "artifact:flow.png");
    assert.equal(view.artifacts[0]?.width, 760);
  });

  it("has no artifacts for results without the field", () => {
    const view = parseToolView(
      call(
        "quick_script",
        { code: "return 1" },
        {
          content: "1",
          details: { status: "completed", durationMs: 1, hostCalls: [] },
        },
      ),
    );
    assert.equal(view.kind === "quick_script" && view.artifacts.length, 0);
  });

  it("keeps a failed script outcome", () => {
    const view = parseToolView(
      call(
        "quick_script",
        { code: "boom()" },
        {
          content: "boom",
          details: {
            status: "failed",
            error: "boom",
            durationMs: 5,
            hostCalls: [],
          },
        },
      ),
    );
    if (view.kind !== "quick_script") assert.fail("wrong kind");
    assert.equal(view.status, "failed");
    assert.equal(outcomeLabel({ status: "completed" }, view), "failed");
    assert.equal(outcomeLabel({ status: "denied" }, view), "denied");
  });
});

describe("extension tool result", () => {
  it("is rendered by the display kind the extension names, for any tool", () => {
    const view = parseToolView(
      call(
        "any_extension_tool",
        { query: "nerve" },
        {
          content: "[]",
          details: {
            extension: "demo",
            tool: "any_extension_tool",
            display: {
              kind: "links",
              value: [{ title: "T", url: "https://x.test" }],
            },
            artifacts: [
              {
                handle: "artifact:a.png",
                path: "/c/a.png",
                bytes: 3,
                mediaType: "image/png",
              },
            ],
          },
        },
      ),
    );
    assert.ok(view.kind === "extension");
    assert.equal(view.extension, "demo");
    assert.equal(view.display.kind, "links");
    assert.equal(view.artifacts[0]?.handle, "artifact:a.png");
  });

  it("falls back to the generic view without display details", () => {
    const view = parseToolView(
      call("any_extension_tool", {}, { content: "plain" }),
    );
    assert.equal(view.kind, "generic");
  });
});

describe("display kinds", () => {
  it("read links, tables and artifact handles tolerantly", () => {
    assert.deepEqual(
      displayLinks([
        { title: "A", url: "https://a.test", snippet: "s" },
        { name: "B", href: "https://b.test", content: "c" },
        { title: "no url" },
      ]),
      [
        { title: "A", url: "https://a.test", snippet: "s" },
        { title: "B", url: "https://b.test", snippet: "c" },
      ],
    );
    assert.deepEqual(displayTable([{ a: 1, b: "x" }, { a: 2 }]), {
      columns: ["a", "b"],
      rows: [
        ["1", "x"],
        ["2", ""],
      ],
    });
    assert.deepEqual(displayTable({ columns: ["k"], rows: [["v"]] }), {
      columns: ["k"],
      rows: [["v"]],
    });
    assert.equal(displayTable("nope"), undefined);
    assert.deepEqual(
      displayArtifactHandles(["artifact:a", { handle: "artifact:b" }, 3]),
      ["artifact:a", "artifact:b"],
    );
  });
});
