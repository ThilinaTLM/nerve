import assert from "node:assert/strict";
import test from "node:test";
import {
  agentInputQueueStateSchema,
  parseAgentInputQueueState,
} from "../../src/domains/agents/agent-input-queue.js";

const now = "2026-10-06T00:00:00.000Z";
function input(id = "input_one", sequence = 0) {
  return {
    id,
    agentId: "agent_child",
    conversationId: "conv_shared",
    idempotencyKey: id,
    origin: { kind: "user", userId: "authorized" },
    role: "user",
    text: "Accepted",
    sequence,
    acceptedAt: now,
    state: "pending",
    eligibility: { kind: "next_turn" },
    activation: "wake_if_idle",
  };
}
function queue() {
  return {
    revision: 1,
    nextSequence: 2,
    paused: false,
    inputs: [input(), input("input_two", 1)],
  };
}
const target = {
  agentId: "agent_child",
  conversationId: "conv_shared",
  runId: "run_original",
  attemptId: "exec_original",
  turnId: "prepared_1",
  requiresProvider: true,
};

test("persisted queue round trips current controls/blockers/receipts/claims without losing scope", () => {
  const value = {
    ...queue(),
    wakeRequested: true,
    controlGeneration: 3,
    admissionBlocker: {
      message: "Unsupported model",
      recordedAt: now,
      configurationRevision: 2,
    },
    acceptedEligibilities: { input_one: { kind: "next_turn" } },
    insertionClaims: { input_one: target },
  };
  assert.deepEqual(
    parseAgentInputQueueState(value, {
      agentId: "agent_child",
      conversationId: "conv_shared",
      documentRevision: 1,
    }),
    value,
  );
  assert.throws(
    () => parseAgentInputQueueState(value, { agentId: "agent_sibling" }),
    /foreign context/,
  );
  assert.throws(
    () =>
      parseAgentInputQueueState(value, {
        agentId: "agent_child",
        conversationId: "conv_sibling",
      }),
    /foreign context/,
  );
  assert.throws(
    () =>
      parseAgentInputQueueState(value, {
        agentId: "agent_child",
        documentRevision: 2,
      }),
    /revision/,
  );
  assert.equal(
    agentInputQueueStateSchema.safeParse({
      revision: 0,
      nextSequence: 0,
      paused: false,
      inputs: [],
    }).success,
    true,
    "legacy omitted optional controls remain readable",
  );
});

test("queue corruption never reorders, deduplicates or resets accepted data", () => {
  const value = queue();
  for (const corrupt of [
    { ...value, inputs: [value.inputs[1], value.inputs[0]] },
    { ...value, nextSequence: 1 },
    {
      ...value,
      inputs: [
        input(),
        { ...input("input_two", 1), idempotencyKey: "input_one" },
      ],
    },
    {
      ...value,
      inputs: [
        input(),
        { ...input("input_one", 1), idempotencyKey: "different" },
      ],
    },
    {
      ...value,
      inputs: [input(), { ...input("input_two", 1), agentId: "agent_sibling" }],
    },
    {
      ...value,
      inputs: [
        input(),
        { ...input("input_two", 1), conversationId: "conv_sibling" },
      ],
    },
    { ...value, paused: true, wakeRequested: true },
    { ...value, controlGeneration: -1 },
    { ...value, contextPending: true },
    { ...value, unknownControlField: "must not be silently stripped" },
  ])
    assert.equal(agentInputQueueStateSchema.safeParse(corrupt).success, false);
  assert.deepEqual(value, queue());
});

test("persisted input fields cannot default into privileged roles or automatic activation on reload", () => {
  assert.equal(
    agentInputQueueStateSchema.safeParse({
      ...queue(),
      inputs: [{ ...input(), role: "system" }],
    }).success,
    false,
  );
  const { eligibility: _eligibility, ...withoutEligibility } = input();
  const { activation: _activation, ...withoutActivation } = input();
  void _eligibility;
  void _activation;
  assert.equal(
    agentInputQueueStateSchema.safeParse({
      ...queue(),
      inputs: [withoutEligibility],
    }).success,
    false,
  );
  assert.equal(
    agentInputQueueStateSchema.safeParse({
      ...queue(),
      inputs: [withoutActivation],
    }).success,
    false,
  );
});

test("insertion claims validate pending identity, context and explicit run/deferred eligibility", () => {
  for (const insertionClaims of [
    { input_missing: target },
    { input_one: { ...target, agentId: "agent_sibling" } },
    { input_one: { ...target, conversationId: "conv_sibling" } },
    { input_one: { ...target, controlGeneration: 9 } },
  ])
    assert.equal(
      agentInputQueueStateSchema.safeParse({ ...queue(), insertionClaims })
        .success,
      false,
    );
  assert.equal(
    agentInputQueueStateSchema.safeParse({
      ...queue(),
      inputs: [{ ...input(), state: "cancelled" }],
      insertionClaims: { input_one: target },
    }).success,
    false,
  );
  const targeted = {
    ...input(),
    eligibility: { kind: "run", runId: "run_other" },
  };
  assert.equal(
    agentInputQueueStateSchema.safeParse({
      ...queue(),
      inputs: [targeted],
      insertionClaims: { input_one: target },
    }).success,
    false,
  );
  const deferred = {
    ...input(),
    eligibility: { kind: "next_run", afterRunId: target.runId },
  };
  assert.equal(
    agentInputQueueStateSchema.safeParse({
      ...queue(),
      inputs: [deferred],
      insertionClaims: { input_one: target },
    }).success,
    false,
  );
});

test("force promotion retains immutable acceptance eligibility while undispatched context survives pause", () => {
  const promoted = {
    ...queue(),
    acceptedEligibilities: {
      input_one: { kind: "next_run", afterRunId: "run_old" },
    },
  };
  assert.equal(agentInputQueueStateSchema.safeParse(promoted).success, true);
  assert.equal(
    agentInputQueueStateSchema.safeParse({
      ...promoted,
      acceptedEligibilities: { input_one: { kind: "run", runId: "run_old" } },
    }).success,
    false,
  );
  const delivered = {
    ...input(),
    state: "delivered",
    delivery: {
      runId: "run_original",
      attemptId: "exec_original",
      turnId: "prepared_1",
      contextEntryId: "entry_input_one",
      deliveredAt: now,
    },
  };
  assert.equal(
    agentInputQueueStateSchema.safeParse({
      ...queue(),
      paused: true,
      contextPending: true,
      inputs: [delivered],
    }).success,
    true,
  );
  assert.equal(
    agentInputQueueStateSchema.safeParse({
      ...queue(),
      inputs: [
        {
          ...delivered,
          delivery: { ...delivered.delivery, contextEntryId: "entry_wrong" },
        },
      ],
    }).success,
    false,
  );
});
