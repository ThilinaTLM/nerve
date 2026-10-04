import assert from "node:assert/strict";
import { it } from "node:test";
import {
  applyCompacted,
  applyCompactionFailed,
  applyCompactionCancelled,
  applyCompactionProgress,
  applyCompactionStarted,
} from "./conversation-compaction-reducer";
import type { ConversationRenderState } from "./conversation-render-state";

it("resets measured usage after compaction without substituting a summary estimate", () => {
  const state = {
    contextUsage: { tokens: 187_194, percent: 69, contextWindow: 272_000 },
    transient: { compaction: { state: "running" } },
  } as ConversationRenderState;
  applyCompacted(state);
  assert.deepEqual(state.contextUsage, {
    tokens: null,
    percent: null,
    contextWindow: 272_000,
  });
  assert.equal(state.transient?.compaction, undefined);
});

it("keeps failed, cancelled, and completed compactions terminal on late progress", () => {
  const ts = "2026-01-01T00:00:00.000Z";
  const base = { conversationId: "conv_test", reason: "manual" as const };
  const progress = {
    ...base,
    sequence: 9,
    attempt: 1,
    preview: "late",
    generatedLines: 1,
    generatedChars: 4,
  };
  for (const terminal of ["failed", "cancelled", "completed"] as const) {
    const state = { conversationId: "conv_test" } as ConversationRenderState;
    applyCompactionStarted(state, { ...base, startedAt: ts }, ts);
    if (terminal === "failed")
      applyCompactionFailed(
        state,
        {
          ...base,
          failedAt: ts,
          message: "Pending tools",
          code: "pending_work",
        },
        ts,
      );
    if (terminal === "cancelled")
      applyCompactionCancelled(state, { ...base, cancelledAt: ts }, ts);
    if (terminal === "completed") applyCompacted(state);
    const before = structuredClone(state.transient);
    applyCompactionProgress(state, progress, ts);
    assert.deepEqual(state.transient, before);
    if (terminal === "failed")
      assert.equal(state.transient?.compaction?.code, "pending_work");
    // An explicit new start, unlike late progress, begins a new operation.
    applyCompactionStarted(state, { ...base, startedAt: ts }, ts);
    applyCompactionProgress(state, progress, ts);
    assert.equal(state.transient?.compaction?.state, "running");
    assert.equal(state.transient?.compaction?.summaryPreview, "late");
  }
});
