import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFileDragTracker } from "./file-drag-tracker";

function harness(idleMs = 1000) {
  let now = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;
  const changes: boolean[] = [];
  const tracker = createFileDragTracker(
    (active) => changes.push(active),
    idleMs,
    {
      set: (fn, ms) => {
        const id = nextId++;
        pending.set(id, { at: now + ms, fn });
        return id;
      },
      clear: (handle) => void pending.delete(handle as number),
    },
  );
  function advance(ms: number) {
    now += ms;
    for (const [id, timer] of [...pending]) {
      if (timer.at <= now) {
        pending.delete(id);
        timer.fn();
      }
    }
  }
  return { tracker, changes, advance };
}

describe("file drag tracker", () => {
  it("stays active until enter/leave depth balances", () => {
    const { tracker, changes } = harness();
    tracker.enter();
    tracker.enter();
    tracker.leave();
    assert.equal(tracker.active, true);
    tracker.leave();
    assert.equal(tracker.active, false);
    assert.deepEqual(changes, [true, false]);
  });

  it("resets on drop/dragend/blur regardless of depth", () => {
    const { tracker, changes } = harness();
    tracker.enter();
    tracker.enter();
    tracker.reset();
    assert.equal(tracker.active, false);
    tracker.enter();
    tracker.leave();
    assert.deepEqual(changes, [true, false, true, false]);
  });

  it("clears a stuck drag when no dragover arrives (missed dragleave)", () => {
    const { tracker, advance } = harness(1000);
    tracker.enter();
    tracker.enter();
    tracker.leave(); // unbalanced: one leave never arrives
    advance(900);
    tracker.over();
    advance(900);
    assert.equal(tracker.active, true);
    advance(200);
    assert.equal(tracker.active, false);
  });

  it("does not leak depth into the next drag after a watchdog reset", () => {
    const { tracker, advance } = harness(1000);
    tracker.enter();
    tracker.enter();
    advance(1000);
    tracker.enter();
    tracker.leave();
    assert.equal(tracker.active, false);
  });
});
