import assert from "node:assert/strict";
import test from "node:test";
import type {
  RunCheckpointRecord,
  RunEventDeliveryRecord,
  RunInteractionRecord,
  RunPromptRecord,
  RunTransitionRecord,
} from "@nervekit/contracts";
import {
  applyRunEventDelivery,
  applyRunTransition,
  reduceRunTransitions,
  RunRevisionConflictError,
} from "../src/index.js";
import { checksum } from "./test-checksum.js";

const at = (second: number) =>
  `2026-07-12T00:00:${String(second).padStart(2, "0")}.000Z`;

function transition(
  revision: number,
  changes: {
    prompts?: RunPromptRecord[];
    interactions?: RunInteractionRecord[];
    checkpoints?: RunCheckpointRecord[];
  } = {},
): RunTransitionRecord {
  return {
    stateEpoch: 1,
    transitionId: `transition_${revision}`,
    runId: "run_x",
    scopeId: "scope",
    revision,
    previousRevision: revision - 1,
    kind: revision === 1 ? "started" : "updated",
    committedAt: at(revision),
    run: {
      runId: "run_x",
      scopeId: "scope",
      revision,
      updatedAt: at(revision),
    },
    prompts: changes.prompts ?? [],
    interactions: changes.interactions ?? [],
    checkpoints: changes.checkpoints ?? [],
    entries: [],
    toolCalls: [],
    events: [],
    checksum: checksum({ revision }),
  } as unknown as RunTransitionRecord;
}

function prompt(id: string, ordinal: number, status: string): RunPromptRecord {
  return { id, ordinal, status } as unknown as RunPromptRecord;
}

function interaction(
  id: string,
  createdAt: string,
  status: string,
): RunInteractionRecord {
  return { id, createdAt, status } as unknown as RunInteractionRecord;
}

function checkpoint(
  checkpointId: string,
  createdAt: string,
  boundary: string,
): RunCheckpointRecord {
  return {
    checkpointId,
    createdAt,
    boundary,
  } as unknown as RunCheckpointRecord;
}

test("incremental transition application matches full reduction", () => {
  const first = transition(1, {
    prompts: [prompt("promptq_b", 2, "queued")],
    interactions: [interaction("interaction_b", at(20), "pending")],
    checkpoints: [
      checkpoint("checkpoint_b", at(20), "before_provider_request"),
    ],
  });
  const second = transition(2, {
    prompts: [
      prompt("promptq_a", 1, "queued"),
      prompt("promptq_b", 3, "delivered"),
    ],
    interactions: [
      interaction("interaction_a", at(10), "pending"),
      interaction("interaction_b", at(20), "resolved"),
    ],
    checkpoints: [
      checkpoint("checkpoint_a", at(10), "after_provider_response"),
      checkpoint("checkpoint_b", at(20), "after_tool_result"),
    ],
  });

  const incremental = applyRunTransition(
    applyRunTransition(undefined, first),
    second,
  );
  const reduced = reduceRunTransitions([second, first]);

  assert.deepEqual(incremental, reduced);
  assert.deepEqual(
    incremental.prompts.map((item) => [item.id, item.ordinal, item.status]),
    [
      ["promptq_a", 1, "queued"],
      ["promptq_b", 3, "delivered"],
    ],
  );
  assert.deepEqual(
    incremental.interactions.map((item) => [item.id, item.status]),
    [
      ["interaction_a", "pending"],
      ["interaction_b", "resolved"],
    ],
  );
  assert.deepEqual(
    incremental.checkpoints.map((item) => [item.checkpointId, item.boundary]),
    [
      ["checkpoint_a", "after_provider_response"],
      ["checkpoint_b", "after_tool_result"],
    ],
  );
});

test("incremental transition application rejects a revision gap", () => {
  const state = applyRunTransition(undefined, transition(1));
  assert.throws(
    () => applyRunTransition(state, transition(3)),
    RunRevisionConflictError,
  );
});

test("full reducer rejects a gap in transition revisions", () => {
  assert.throws(
    () => reduceRunTransitions([transition(1), transition(3)]),
    RunRevisionConflictError,
  );
});

test("delivery application ignores retry timestamps and rejects publication conflicts", () => {
  const state = applyRunTransition(undefined, transition(1));
  const delivery: RunEventDeliveryRecord = {
    intentId: "intent_1",
    runId: "run_x",
    revision: 1,
    eventId: "event_1",
    sequence: 4,
    deliveredAt: at(30),
  };
  const delivered = applyRunEventDelivery(state, delivery);

  assert.equal(applyRunEventDelivery(delivered, delivery), delivered);
  assert.equal(
    applyRunEventDelivery(delivered, {
      ...delivery,
      deliveredAt: at(31),
    }),
    delivered,
  );
  assert.throws(
    () =>
      applyRunEventDelivery(delivered, {
        ...delivery,
        eventId: "event_conflict",
      }),
    /Conflicting event delivery/,
  );
});
