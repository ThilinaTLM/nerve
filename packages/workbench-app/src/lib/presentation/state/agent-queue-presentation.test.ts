import assert from "node:assert/strict";
import { it } from "node:test";
import type { AgentInputRecord } from "@nervekit/contracts/agents";
import {
  pendingQueueItems,
  queueItemLabel,
  queueItemPending,
  queueItemRevision,
} from "./agent-queue-presentation";
import { buildConversationRenderProjection } from "./render";
import { applyConversationEvent } from "./conversation-event-reducer";
import { emptyConversationRenderState } from "./conversation-render-state";
const input = (
  sequence: number,
  patch: Partial<AgentInputRecord> = {},
): AgentInputRecord => ({
  id: `input_${sequence}`,
  agentId: "agent_child",
  conversationId: "conv_shared",
  idempotencyKey: `accept_${sequence}`,
  text: `Message ${sequence}`,
  role: "user",
  origin: { kind: "parent", agentId: "agent_root" },
  state: "pending",
  eligibility: { kind: "next_turn" },
  activation: "queue_only",
  sequence,
  acceptedAt: "2026-10-06T00:00:00.000Z",
  ...patch,
});
it("shows pending user/system/next-run input in acceptance order even when paused or no run exists", () => {
  const system = input(2, {
    role: "system",
    origin: {
      kind: "system",
      producer: "completion",
      correlationId: "run_original",
    },
    eligibility: { kind: "next_run", afterRunId: "run_previous" },
  });
  const parent = input(1);
  const cancelled = input(3, { state: "cancelled" });
  const obsolete = input(4, { state: "obsolete" });
  const state = {
    ...emptyConversationRenderState("conv_shared"),
    queuedPrompts: [system, cancelled, parent, obsolete],
  };
  const projection = buildConversationRenderProjection(state);
  assert.deepEqual(
    projection.queuedPrompts.map((item) => item.id),
    ["input_1", "input_2"],
  );
  assert.equal(projection.queuedPrompts[0], parent);
  assert.equal(projection.queuedPrompts[1], system);
  assert.match(queueItemLabel(system), /Queued for next run/);
  assert.equal(queueItemLabel(parent), "Queued for next turn");
  assert.equal(queueItemPending(cancelled), false);
  assert.equal(pendingQueueItems([obsolete]).length, 0);
  assert.match(queueItemRevision(system), /^pending:2:/);
});
it("run settlement cannot erase an agent-owned next-run item from the UI queue", () => {
  const queued = input(1, {
    eligibility: { kind: "next_run", afterRunId: "run_previous" },
  });
  let state = {
    ...emptyConversationRenderState("conv_shared"),
    queuedPrompts: [queued],
  };
  const base = {
    conversationId: "conv_shared",
    agentId: "agent_child",
    projectId: "proj_shared",
    runId: "run_previous",
  };
  const ts = "2026-10-06T00:00:00.000Z";
  state = applyConversationEvent(state, {
    id: "evt_started",
    seq: 1,
    ts,
    type: "run.started",
    data: { ...base, startedAt: ts },
  }) as typeof state;
  state = applyConversationEvent(state, {
    id: "evt_completed",
    seq: 2,
    ts,
    type: "run.completed",
    data: { ...base, completedAt: ts },
  }) as typeof state;
  assert.equal(state.queuedPrompts[0], queued);
  assert.equal(state.activeRun, undefined);
  assert.equal(
    buildConversationRenderProjection(state).queuedPrompts[0]?.id,
    "input_1",
  );
});

it("delivered input stops appearing as pending without remapping its durable identity", () => {
  const delivered = input(1, {
    state: "delivered",
    delivery: {
      runId: "run_child",
      attemptId: "attempt_exact",
      turnId: "turn_exact",
      contextEntryId: "entry_input_1",
      deliveredAt: "2026-10-06T00:01:00.000Z",
    },
  });
  assert.equal(queueItemPending(delivered), false);
  assert.equal(delivered.id, "input_1");
  assert.match(queueItemRevision(delivered), /delivered:1:2026-10-06T00:01/);
});
