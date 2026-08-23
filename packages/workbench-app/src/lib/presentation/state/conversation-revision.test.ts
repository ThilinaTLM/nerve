import type { EventEnvelope } from "@nervekit/contracts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyConversationEvent,
  emptyConversationRenderState,
} from "./index.js";

const startedAt = "2026-08-23T00:00:00.000Z";

function startRun(seq: number, conversationRevision: number): EventEnvelope {
  return {
    id: `event_${seq}`,
    seq,
    ts: startedAt,
    type: "run.started",
    data: {
      conversationId: "conv_test",
      conversationRevision,
      agentId: "agent_test",
      runId: "run_test",
      projectId: "proj_test",
      startedAt,
    },
  };
}

describe("conversation revision convergence", () => {
  it("treats aggregate revisions as a monotonic watermark, not a dense sequence", () => {
    const state = {
      ...emptyConversationRenderState("conv_test"),
      conversationRevision: 5,
    };
    const stale = applyConversationEvent(state, startRun(1, 4));
    assert.equal(stale.activeRun, undefined);
    assert.equal(stale.cursorSeq, 1);
    assert.equal(stale.conversationRevision, 5);

    let gaps = 0;
    const advanced = applyConversationEvent(
      { ...state, cursorSeq: 1 },
      startRun(2, 9),
      { onGap: () => gaps++ },
    );
    assert.equal(advanced.activeRun?.runId, "run_test");
    assert.equal(advanced.cursorSeq, 2);
    assert.equal(advanced.conversationRevision, 9);
    assert.equal(gaps, 0);
  });

  it("still requests recovery for a public stream sequence gap", () => {
    const state = {
      ...emptyConversationRenderState("conv_test"),
      conversationRevision: 5,
    };
    let gaps = 0;
    const gap = applyConversationEvent(state, startRun(2, 9), {
      onGap: () => gaps++,
    });
    assert.equal(gap, state);
    assert.equal(gaps, 1);
  });

  it("renders compaction progress across aggregate-only journal commits", () => {
    const state = {
      ...emptyConversationRenderState("conv_test"),
      cursorSeq: 1,
      conversationRevision: 5,
    };
    let gaps = 0;
    const progress = applyConversationEvent(
      state,
      {
        id: "event_2",
        seq: 2,
        ts: startedAt,
        type: "conversation.compaction.progress",
        data: {
          conversationId: "conv_test",
          conversationRevision: 12,
          agentId: "agent_test",
          runId: "run_test",
          reason: "manual",
          sequence: 1,
          attempt: 1,
          preview: "## Goal\nKeep streaming",
          generatedLines: 2,
          generatedChars: 22,
        },
      },
      { onGap: () => gaps++ },
    );

    assert.equal(progress.transient?.compaction?.state, "running");
    assert.equal(
      progress.transient?.compaction?.summaryPreview,
      "## Goal\nKeep streaming",
    );
    assert.equal(progress.cursorSeq, 2);
    assert.equal(progress.conversationRevision, 12);
    assert.equal(gaps, 0);
  });
});
