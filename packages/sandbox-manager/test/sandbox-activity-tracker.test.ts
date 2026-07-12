import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SandboxActivitySummary } from "@nervekit/contracts";
import { SandboxActivityTracker } from "../src/events/sandbox-activity-tracker.js";

function collector() {
  const emitted: SandboxActivitySummary[] = [];
  const tracker = new SandboxActivityTracker((summary) =>
    emitted.push({ ...summary }),
  );
  return { emitted, tracker };
}

describe("SandboxActivityTracker", () => {
  it("derives run status and a current-task title from controller events", () => {
    const { tracker } = collector();
    tracker.observe("sbx1", { type: "run.started", payload: { runId: "r1" } });
    tracker.observe("sbx1", {
      type: "toolCall.updated",
      payload: { toolName: "Edit", displayArgs: { path: "src/auth.ts" } },
    });

    const summary = tracker.get("sbx1");
    assert.equal(summary?.runStatus, "running");
    assert.equal(summary?.title, "Edit: src/auth.ts");
  });

  it("emits immediately on attention and terminal transitions", () => {
    const { emitted, tracker } = collector();
    tracker.observe("sbx1", {
      type: "run.waiting",
      payload: { approvalId: "a1" },
    });
    assert.equal(emitted.at(-1)?.needsAttention, true);
    assert.equal(emitted.at(-1)?.runStatus, "waiting");

    tracker.observe("sbx1", {
      type: "run.completed",
      payload: { runId: "r1" },
    });
    assert.equal(emitted.at(-1)?.runStatus, "completed");
    assert.equal(emitted.at(-1)?.needsAttention, undefined);
  });

  it("uses the latest assistant transcript line as the title", () => {
    const { tracker } = collector();
    tracker.observe("sbx1", { type: "run.started", payload: {} });
    tracker.observe("sbx1", {
      type: "run.transcript.appended",
      payload: {
        role: "assistant",
        content: { text: "Running the tests now" },
      },
    });
    assert.equal(tracker.get("sbx1")?.title, "Running the tests now");
  });

  it("ignores non-assistant transcript entries", () => {
    const { tracker } = collector();
    tracker.observe("sbx1", { type: "run.started", payload: {} });
    tracker.observe("sbx1", {
      type: "run.transcript.appended",
      payload: { role: "user", content: { text: "do the thing" } },
    });
    assert.equal(tracker.get("sbx1")?.title, undefined);
  });

  it("reads model/provider from the run.started payload", () => {
    const { tracker } = collector();
    tracker.observe("sbx1", {
      type: "run.started",
      payload: {
        runId: "r1",
        model: { provider: "anthropic", model: "claude-sonnet-4-5" },
      },
    });
    assert.equal(tracker.get("sbx1")?.model, "claude-sonnet-4-5");
    assert.equal(tracker.get("sbx1")?.provider, "anthropic");
  });

  it("derives context usage percentage from a contextUsage payload", () => {
    const { tracker } = collector();
    tracker.observe("sbx1", { type: "run.started", payload: {} });
    tracker.observe("sbx1", {
      type: "run.completed",
      payload: { contextUsage: { tokens: 62_000, contextWindow: 100_000 } },
    });
    assert.equal(tracker.get("sbx1")?.contextUsagePct, 62);
  });

  it("enriches with model and context usage via setRunMeta", () => {
    const { tracker } = collector();
    tracker.observe("sbx1", { type: "run.started", payload: {} });
    tracker.setRunMeta("sbx1", {
      model: "claude-sonnet-4-5",
      provider: "anthropic",
      contextUsagePct: 62,
    });
    const summary = tracker.get("sbx1");
    assert.equal(summary?.model, "claude-sonnet-4-5");
    assert.equal(summary?.provider, "anthropic");
    assert.equal(summary?.contextUsagePct, 62);
  });

  it("marks idle on controller disconnect", () => {
    const { tracker } = collector();
    tracker.observe("sbx1", { type: "run.started", payload: {} });
    tracker.observe("sbx1", {
      type: "sandbox.controller.disconnected",
      payload: {},
    });
    assert.equal(tracker.get("sbx1")?.runStatus, "idle");
  });
});
