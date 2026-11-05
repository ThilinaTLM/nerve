import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EventEnvelope } from "@nervekit/contracts/events";
import {
  buildEventBatch,
  chunkEvents,
  estimateProtocolMessageBytes,
} from "../../src/streams/event-batch.js";

const event = (
  seq: number,
  data: Record<string, unknown> = {},
): EventEnvelope =>
  ({
    seq,
    id: `evt_${seq}`,
    ts: "2026-07-18T00:00:00.000Z",
    type: "project.created",
    data,
  }) as EventEnvelope;
const shape = (chunks: EventEnvelope[][]) =>
  chunks.map((c) => c.map((e) => e.seq));

describe("event batches", () => {
  it("splits chunks by event count", () => {
    const events = [1, 2, 3, 4, 5].map((n) => event(n));
    assert.deepEqual(shape(chunkEvents(events, 2)), [[1, 2], [3, 4], [5]]);
  });

  it("splits by bytes but always keeps at least one event per chunk", () => {
    const events = [1, 2, 3].map((n) => event(n, { pad: "x".repeat(50) }));
    const one = Buffer.byteLength(JSON.stringify(events[0]));
    assert.deepEqual(shape(chunkEvents(events, 10, one * 2)), [[1, 2], [3]]);
    assert.deepEqual(shape(chunkEvents(events, 10, 1)), [[1], [2], [3]]);
  });

  it("starts a new chunk at a seq gap and returns nothing for no events", () => {
    assert.deepEqual(shape(chunkEvents([event(1), event(2), event(5)], 10)), [
      [1, 2],
      [5],
    ]);
    assert.deepEqual(chunkEvents([], 10), []);
  });

  it("builds batches with first/last seq, and null bounds when empty", () => {
    const batch = buildEventBatch([event(3), event(4)], {
      stream: "s",
      reason: "live",
    });
    assert.equal(batch.firstSeq, 3);
    assert.equal(batch.lastSeq, 4);
    assert.match(batch.batchId, /^batch_/);
    const empty = buildEventBatch([], {
      stream: "s",
      reason: "live",
      batchId: "b",
    });
    assert.equal(empty.firstSeq, null);
    assert.equal(empty.lastSeq, null);
  });

  it("rejects non-consecutive input when building a batch", () => {
    assert.throws(() =>
      buildEventBatch([event(1), event(3)], { stream: "s", reason: "live" }),
    );
  });

  it("estimates the encoded wire size including the kind", () => {
    assert.equal(
      estimateProtocolMessageBytes("event", { a: 1 }),
      Buffer.byteLength(JSON.stringify({ kind: "event", data: { a: 1 } })),
    );
  });
});
