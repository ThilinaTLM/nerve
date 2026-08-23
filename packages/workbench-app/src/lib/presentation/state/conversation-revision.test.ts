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
  it("ignores stale revisions and requests a snapshot on a forward gap", () => {
    const state = {
      ...emptyConversationRenderState("conv_test"),
      conversationRevision: 5,
    };
    const stale = applyConversationEvent(state, startRun(1, 4));
    assert.equal(stale.activeRun, undefined);
    assert.equal(stale.cursorSeq, 1);

    let gaps = 0;
    const gap = applyConversationEvent(
      { ...state, cursorSeq: 1 },
      startRun(2, 7),
      { onGap: () => gaps++ },
    );
    assert.equal(gap.activeRun, undefined);
    assert.equal(gap.cursorSeq, 1);
    assert.equal(gaps, 1);
  });
});
