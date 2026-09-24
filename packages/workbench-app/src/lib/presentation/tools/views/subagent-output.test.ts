import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolView } from "./tool-view-types";
import { subagentOutput, subagentTranscriptTargets } from "./subagent-output";

type SubagentView = Extract<ToolView, { kind: "subagent" }>;
const teammate = {
  agentId: "child-1",
  name: "startup-gate",
  state: "idle" as const,
  outcome: "completed" as const,
};
function view(patch: Partial<SubagentView> = {}): SubagentView {
  return {
    kind: "subagent",
    action: "status",
    teammates: [teammate],
    hasMore: false,
    previewUnavailable: false,
    ...patch,
  };
}

describe("subagent card output", () => {
  it("shows the status response once, or an explicit no-response result", () => {
    assert.equal(
      subagentOutput(
        view({
          response: {
            text: "Done.\nAll pass.",
            complete: true,
            runId: "run-1",
          },
        }),
      ),
      "Done.\nAll pass.",
    );
    assert.equal(subagentOutput(view()), "No response yet.");
    assert.equal(
      subagentOutput(
        view({
          response: { text: "Still working", complete: false, runId: "run-1" },
          hidden: { count: 4, noun: "lines" },
        }),
      ),
      "Still working",
    );
  });

  it("omits the redundant prompt result but keeps new and stop results", () => {
    assert.equal(
      subagentOutput(
        view({
          action: "prompt",
          teammates: [{ name: "startup-gate", state: "running" }],
        }),
      ),
      undefined,
    );
    for (const action of ["new", "stop"] as const) {
      assert.equal(
        subagentOutput(view({ action })),
        "startup-gate · completed",
      );
    }
  });

  it("formats visible list entries as one output and retains empty/unavailable fallback", () => {
    const listed = view({
      action: "list",
      teammates: [teammate, { name: "api", state: "running" }],
    });
    assert.equal(
      subagentOutput({ ...listed, hidden: { count: 3, noun: "teammates" } }),
      "startup-gate · completed\napi · running",
    );
    assert.equal(
      subagentOutput(view({ action: "list", teammates: [] })),
      undefined,
    );
    assert.equal(subagentOutput(view({ previewUnavailable: true })), undefined);
  });

  it("offers transcript targets only when parent and child IDs are present", () => {
    const listed = view({
      action: "list",
      teammates: [teammate, { name: "legacy", state: "idle" }],
    });
    assert.deepEqual(subagentTranscriptTargets(listed, "parent"), [
      { agentId: "child-1", name: "startup-gate" },
    ]);
    assert.deepEqual(subagentTranscriptTargets(listed, undefined), []);
    assert.deepEqual(
      subagentTranscriptTargets(view({ previewUnavailable: true }), "parent"),
      [],
    );
  });
});
