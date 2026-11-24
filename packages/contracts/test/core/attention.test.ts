import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AttentionEdgeTracker,
  mostUrgent,
  type ConversationSummary,
} from "../../src/domains/core/index.js";

function summary(
  patch: Partial<ConversationSummary> = {},
): ConversationSummary {
  return {
    id: "root",
    parentConversationId: null,
    status: "idle",
    pendingWork: false,
    pendingInput: null,
    ...patch,
  } as ConversationSummary;
}

void describe("attention edges", () => {
  void it("picks the most urgent coinciding edge: input > failure > finished", () => {
    assert.equal(
      mostUrgent([{ kind: "finished" }, { kind: "failed" }, { kind: "input" }])
        ?.kind,
      "input",
    );
    assert.equal(
      mostUrgent([{ kind: "finished" }, { kind: "interrupted" }])?.kind,
      "interrupted",
    );
    assert.equal(mostUrgent([]), undefined);
  });

  void it("tracks root baselines quietly and reports one edge per transition", () => {
    const tracker = new AttentionEdgeTracker();
    tracker.seed([summary({ status: "running" })]);
    assert.equal(tracker.observe(summary({ status: "running" })), undefined);
    assert.deepEqual(tracker.observe(summary({ status: "idle" })), {
      kind: "finished",
    });
    // Unknown conversations only set a baseline.
    assert.equal(
      tracker.observe(summary({ id: "new", status: "failed" })),
      undefined,
    );
    // Sub-agents never report.
    const child = summary({ id: "c", parentConversationId: "root" });
    assert.equal(tracker.observe(child), undefined);
    assert.equal(tracker.observe({ ...child, status: "failed" }), undefined);
  });

  void it("lets the caller suppress the completion after a Stop", () => {
    const tracker = new AttentionEdgeTracker(
      (_id, edge) => edge.kind === "interrupted",
    );
    tracker.seed([summary({ status: "running" })]);
    assert.equal(
      tracker.observe(summary({ status: "interrupted" })),
      undefined,
    );
    tracker.observe(summary({ status: "running" }));
    assert.deepEqual(tracker.observe(summary({ status: "failed" })), {
      kind: "failed",
    });
  });
});
