import type { EventEnvelope } from "@nervekit/contracts/events";
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyConversationEvent,
  emptyConversationRenderState,
} from "./index.js";

const ts = "2026-09-05T08:30:08.090Z";

function event(seq: number, type: string, data: unknown): EventEnvelope {
  return { id: `evt_${seq}`, seq, ts, type, data };
}

test("settlement-owned runs stay busy until cancellation completes", () => {
  let state = applyConversationEvent(
    emptyConversationRenderState("conv_test"),
    event(1, "run.started", {
      conversationId: "conv_test",
      agentId: "agent_test",
      projectId: "proj_test",
      runId: "run_test",
      startedAt: ts,
    }),
  );
  state = { ...state, sending: false };
  state = applyConversationEvent(
    state,
    event(2, "run.settlement.updated", {
      runId: "run_test",
      settlement: {
        id: "approval:checkpoint_test",
        conversationId: "conv_test",
        runId: "run_test",
        executionId: "exec_test",
        checkpointId: "checkpoint_test",
        toolCallIds: ["tool_test"],
        phase: "blocked",
        revision: 2,
        attempts: 1,
        createdAt: ts,
        updatedAt: ts,
      },
    }),
  );
  assert.equal(state.activeRun?.status, "settling");
  assert.equal(state.sending, true);

  state = applyConversationEvent(
    state,
    event(3, "run.cancelled", { runId: "run_test" }),
  );
  assert.equal(state.activeRun, undefined);
  assert.equal(state.sending, false);
});
