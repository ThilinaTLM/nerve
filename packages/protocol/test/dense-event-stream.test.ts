import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EventEnvelope } from "@nervekit/contracts";
import {
  applyEventBatch,
  buildEventBatch,
  chunkEvents,
  createClientEventStreamState,
  markProcessed,
} from "../src/index.js";

const ts = "2026-07-18T00:00:00.000Z";
const event = (seq: number): EventEnvelope => ({
  seq,
  id: `evt_${seq}`,
  ts,
  type: "project.created",
  data: {},
});

describe("dense event stream", () => {
  it("builds and chunks only consecutive runs", () => {
    assert.deepEqual(
      buildEventBatch([event(1), event(2)], {
        stream: "workspace",
        reason: "live",
        batchId: "batch_test",
      }),
      {
        stream: "workspace",
        batchId: "batch_test",
        reason: "live",
        events: [event(1), event(2)],
        firstSeq: 1,
        lastSeq: 2,
      },
    );
    assert.throws(() =>
      buildEventBatch([event(1), event(3)], {
        stream: "workspace",
        reason: "live",
      }),
    );
    assert.deepEqual(
      chunkEvents([event(1), event(2), event(4)], 10).map((events) =>
        events.map(({ seq }) => seq),
      ),
      [[1, 2], [4]],
    );
  });

  it("skips duplicates and advances only when the caller marks apply success", () => {
    const state = createClientEventStreamState(1);
    const queued: number[] = [];
    const result = applyEventBatch(
      buildEventBatch([event(1), event(2)], {
        stream: "workspace",
        reason: "replay",
      }),
      state,
      ({ seq }) => queued.push(seq),
      "workspace",
    );
    assert.deepEqual(queued, [2]);
    assert.equal(result.duplicateEvents, 1);
    assert.equal(state.processedSeq, 1);
    markProcessed(state, 2);
    assert.equal(state.processedSeq, 2);
  });

  it("reports a gap without applying later events", () => {
    const state = createClientEventStreamState(1);
    const queued: number[] = [];
    const result = applyEventBatch(
      buildEventBatch([event(3)], {
        stream: "workspace",
        reason: "live",
      }),
      state,
      ({ seq }) => queued.push(seq),
      "workspace",
    );
    assert.deepEqual(queued, []);
    assert.deepEqual(result.gap, { expectedSeq: 2, receivedSeq: 3 });
    assert.equal(state.processedSeq, 1);
  });
});
