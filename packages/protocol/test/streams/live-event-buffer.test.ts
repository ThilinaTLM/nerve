import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EventEnvelope } from "@nervekit/contracts/events";
import { LiveEventBuffer } from "../../src/streams/live-event-buffer.js";

const event = (seq: number): EventEnvelope => ({
  seq,
  id: `evt_${seq}`,
  ts: "2026-07-18T00:00:00.000Z",
  type: "project.created",
  data: {},
});
const seqs = (events: EventEnvelope[]) => events.map((e) => e.seq);

describe("LiveEventBuffer", () => {
  it("keeps pending and replay events separate per stream, in arrival order", () => {
    const buffer = new LiveEventBuffer();
    buffer.enqueue("a", event(1), false);
    buffer.enqueue("a", event(2), false);
    buffer.enqueue("a", event(3), true);
    buffer.enqueue("b", event(4), false);
    assert.deepEqual(seqs(buffer.all()), [1, 2, 4, 3]);
    assert.deepEqual(seqs(buffer.takeReplay("a")), [3]);
    assert.deepEqual(buffer.takeReplay("a"), []);
  });

  it("takePending hands over and clears pending events only", () => {
    const buffer = new LiveEventBuffer();
    buffer.enqueue("a", event(1), false);
    buffer.enqueue("a", event(2), true);
    const pending = buffer.takePending();
    assert.deepEqual(seqs(pending.get("a") ?? []), [1]);
    assert.equal(buffer.takePending().size, 0);
    assert.deepEqual(seqs(buffer.all()), [2]);
  });

  it("drops inactive, removed and cleared streams", () => {
    const buffer = new LiveEventBuffer();
    for (const stream of ["a", "b", "c"]) {
      buffer.enqueue(stream, event(1), false);
      buffer.enqueue(stream, event(2), true);
    }
    buffer.dropInactive(new Set(["a", "b"]));
    assert.equal(buffer.all().length, 4);
    buffer.remove("a");
    assert.equal(buffer.all().length, 2);
    buffer.clear();
    assert.deepEqual(buffer.all(), []);
  });
});
