import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EventBatchData, EventEnvelope } from "@nervekit/contracts";
import {
  applyEventBatch,
  createClientEventStreamState,
  markProcessed,
} from "./event-stream";

const ts = "2026-06-26T12:00:00.000Z";

function event(
  seq: number,
  durability: "durable" | "transient" = "durable",
): EventEnvelope<Record<string, unknown>> {
  return {
    seq,
    id: `evt_${seq}`,
    ts,
    type:
      durability === "durable" ? "project.created" : "conversation.live.delta",
    durability,
    data: {},
  };
}

function batch(
  events: EventEnvelope<Record<string, unknown>>[],
  previousDurableSeq: number | undefined,
): EventBatchData {
  const durable = events.filter(
    (candidate) => candidate.durability === "durable",
  );
  return {
    stream: "global",
    batchId: "bat_test",
    reason: "live",
    events,
    range: {
      firstSeq: events[0]?.seq ?? null,
      lastSeq: events.at(-1)?.seq ?? null,
      durableFirstSeq: durable[0]?.seq ?? null,
      durableLastSeq: durable.at(-1)?.seq ?? null,
      durableCount: durable.length,
      transientCount: events.length - durable.length,
      previousDurableSeq,
      durableCompleteThroughSeq: durable.at(-1)?.seq,
    },
  };
}

describe("protocol event stream", () => {
  it("enqueues valid event batches and advances continuity before ack", () => {
    const state = createClientEventStreamState(0);
    const queued: EventEnvelope[] = [];

    const result = applyEventBatch(
      batch([event(1), event(2, "transient")], 0),
      state,
      (candidate) => {
        queued.push(candidate);
      },
    );

    assert.equal(result.replayRequired, undefined);
    assert.equal(result.durableEventsQueued, 1);
    assert.equal(state.continuitySeq, 1);
    assert.deepEqual(
      queued.map((candidate) => candidate.seq),
      [1, 2],
    );
  });

  it("ignores duplicate durable events after they are processed", () => {
    const state = createClientEventStreamState(0);
    markProcessed(state, 2);
    const queued: EventEnvelope[] = [];

    const result = applyEventBatch(
      batch([event(1), event(3)], 2),
      state,
      (candidate) => {
        queued.push(candidate);
      },
    );

    assert.equal(result.duplicateEvents, 1);
    assert.deepEqual(
      queued.map((candidate) => candidate.seq),
      [3],
    );
  });

  it("does not advance processed cursor for transient-only batches", () => {
    const state = createClientEventStreamState(5);
    const queued: EventEnvelope[] = [];

    const result = applyEventBatch(
      batch([event(6, "transient")], undefined),
      state,
      (candidate) => queued.push(candidate),
    );

    assert.equal(result.durableEventsQueued, 0);
    assert.equal(state.processedSeq, 5);
    assert.equal(state.continuitySeq, 5);
    assert.deepEqual(
      queued.map((candidate) => candidate.seq),
      [6],
    );
  });

  it("requests replay when durable continuity is not proven", () => {
    const state = createClientEventStreamState(5);
    const queued: EventEnvelope[] = [];

    const result = applyEventBatch(
      batch([event(10)], 8),
      state,
      (candidate) => {
        queued.push(candidate);
      },
    );

    assert.deepEqual(result.replayRequired, {
      fromSeq: 5,
      reason: "gap_detected",
    });
    assert.deepEqual(queued, []);
  });
});
