import assert from "node:assert/strict";
import test from "node:test";
import { createScrollMetrics, distanceFromEnd } from "./scroll-metrics";

function harness() {
  let reads = 0;
  let value = 100;
  const frames = new Map<number, () => void>();
  let nextId = 1;
  const metrics = createScrollMetrics(
    () => {
      reads += 1;
      return value;
    },
    (cb) => {
      frames.set(nextId, cb);
      return nextId++;
    },
    (id) => void frames.delete(id),
  );
  return {
    metrics,
    reads: () => reads,
    set: (v: number) => (value = v),
    runFrame: () => {
      const pending = [...frames.values()];
      frames.clear();
      for (const cb of pending) cb();
    },
  };
}

test("reads layout once per frame and refreshes next frame", () => {
  const h = harness();
  assert.equal(h.metrics.maxScrollOffset(), 100);
  h.set(200);
  assert.equal(h.metrics.maxScrollOffset(), 100);
  assert.equal(h.reads(), 1);
  h.runFrame();
  assert.equal(h.metrics.maxScrollOffset(), 200);
  assert.equal(h.reads(), 2);
});

test("invalidate forces a fresh read", () => {
  const h = harness();
  h.metrics.maxScrollOffset();
  h.set(50);
  h.metrics.invalidate();
  assert.equal(h.metrics.maxScrollOffset(), 50);
});

test("distanceFromEnd clamps at zero", () => {
  assert.equal(distanceFromEnd(100, 120), 0);
  assert.equal(distanceFromEnd(100, 40), 60);
});
