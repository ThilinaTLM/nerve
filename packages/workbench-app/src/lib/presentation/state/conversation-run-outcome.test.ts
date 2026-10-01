import type { EventEnvelope } from "@nervekit/contracts/events";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyConversationEvent,
  emptyConversationRenderState,
} from "./index.js";

const ts = "2026-07-07T00:00:00.000Z";

function evt(seq: number, type: string, data: unknown): EventEnvelope {
  return { id: `evt_${seq}`, seq, ts, type, data };
}

function startRun(seq = 1): EventEnvelope {
  return evt(seq, "run.started", {
    conversationId: "conv_test",
    agentId: "agent_test",
    runId: "run_test",
    projectId: "proj_test",
    startedAt: ts,
  });
}

describe("last run outcome", () => {
  const ids = {
    conversationId: "conv_test",
    agentId: "agent_test",
    projectId: "proj_test",
  };
  const endedAt = "2026-07-07T00:00:42.000Z";
  const started = () =>
    applyConversationEvent(
      emptyConversationRenderState("conv_test"),
      startRun(),
    );

  const cases: Array<
    [string, EventEnvelope, "completed" | "stopped" | "failed"]
  > = [
    [
      "run.completed",
      evt(2, "run.completed", {
        ...ids,
        runId: "run_test",
        completedAt: endedAt,
      }),
      "completed",
    ],
    [
      "run.cancelled",
      evt(2, "run.cancelled", {
        ...ids,
        runId: "run_test",
        cancelledAt: endedAt,
      }),
      "stopped",
    ],
    [
      "aborted run.failed",
      evt(2, "run.failed", {
        ...ids,
        runId: "run_test",
        message: "aborted",
        aborted: true,
        failedAt: endedAt,
      }),
      "stopped",
    ],
    [
      "run.failed",
      evt(2, "run.failed", {
        ...ids,
        runId: "run_test",
        message: "boom",
        aborted: false,
        failedAt: endedAt,
      }),
      "failed",
    ],
  ];
  for (const [name, event, outcome] of cases) {
    it(`records ${outcome} with the run span on ${name}`, () => {
      const state = applyConversationEvent(started(), event);
      assert.equal(state.activeRun, undefined);
      assert.deepEqual(state.lastRunOutcome, {
        runId: "run_test",
        outcome,
        startedAt: ts,
        endedAt,
      });
    });
  }

  it("ignores terminal events for a stale run", () => {
    const state = applyConversationEvent(
      started(),
      evt(2, "run.completed", {
        ...ids,
        runId: "run_other",
        completedAt: endedAt,
      }),
    );
    assert.equal(state.lastRunOutcome, undefined);
    assert.equal(state.activeRun?.runId, "run_test");
  });

  it("clears the outcome when the next run starts", () => {
    let state = applyConversationEvent(
      started(),
      evt(2, "run.completed", {
        ...ids,
        runId: "run_test",
        completedAt: endedAt,
      }),
    );
    state = applyConversationEvent(state, startRun(3));
    assert.equal(state.lastRunOutcome, undefined);
  });
});
