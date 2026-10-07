import assert from "node:assert/strict";
import { it } from "node:test";
import { applyRunWaitingProjection } from "./conversation-terminal-state";
import type { ConversationViewState } from "./conversation-state.svelte";
import type { AgentInputRecord } from "@nervekit/contracts/agents";
it("human review suspension preserves accepted agent input without delivering or waking it", () => {
  const input: AgentInputRecord = {
    id: "input_pending",
    agentId: "agent_child",
    conversationId: "conv_shared",
    idempotencyKey: "same-caller",
    origin: { kind: "parent", agentId: "agent_parent" },
    role: "user",
    text: "After review",
    sequence: 1,
    acceptedAt: "2026-10-06T00:00:00.000Z",
    eligibility: { kind: "next_turn" },
    activation: "queue_only",
    state: "pending",
  };
  const view = {
    queuedPrompts: [input],
    sending: true,
    activeRun: { runId: "run_child", status: "running", queuedPrompts: [] },
  } as unknown as ConversationViewState;
  applyRunWaitingProjection(view, "run_child");
  assert.equal(view.sending, false);
  assert.equal(view.activeRun?.status, "waiting");
  assert.equal(view.queuedPrompts[0], input);
  assert.equal(input.state, "pending");
  assert.equal(input.delivery, undefined);
});
