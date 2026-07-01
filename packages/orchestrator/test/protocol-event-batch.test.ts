import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EventEnvelope } from "@nervekit/shared";
import { buildEventBatch, chunkEvents } from "../src/protocol/event-batch.js";

const ts = "2026-06-26T12:00:00.000Z";

function event(
  seq: number,
  durability: "durable" | "transient" = "durable",
): EventEnvelope {
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

describe("protocol event batches", () => {
  it("builds mixed durable/transient range metadata", () => {
    const batch = buildEventBatch([event(3, "transient"), event(2)], {
      reason: "live",
      previousDurableSeq: 1,
    });

    assert.deepEqual(
      batch.events.map((candidate) => candidate.seq),
      [2, 3],
    );
    assert.equal(batch.range.firstSeq, 2);
    assert.equal(batch.range.lastSeq, 3);
    assert.equal(batch.range.durableFirstSeq, 2);
    assert.equal(batch.range.durableLastSeq, 2);
    assert.equal(batch.range.durableCount, 1);
    assert.equal(batch.range.transientCount, 1);
    assert.equal(batch.range.previousDurableSeq, 1);
    assert.equal(batch.range.durableCompleteThroughSeq, 2);
  });

  it("builds transient-only batches without durable continuity fields", () => {
    const batch = buildEventBatch([event(4, "transient")], {
      reason: "live",
      previousDurableSeq: 3,
    });

    assert.equal(batch.range.durableCount, 0);
    assert.equal(batch.range.transientCount, 1);
    assert.equal(batch.range.durableFirstSeq, undefined);
    assert.equal(batch.range.previousDurableSeq, undefined);
  });

  it("chunks events by configured count", () => {
    assert.deepEqual(
      chunkEvents([event(1), event(2), event(3)], 2).map((chunk) =>
        chunk.map((candidate) => candidate.seq),
      ),
      [[1, 2], [3]],
    );
  });
});
