import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StreamingRevealLoop } from "./streaming-reveal-loop.js";

const FRAME_MS = 1000 / 60;

function fakeFrames() {
  let next = 1;
  let now = 0;
  const pending = new Map<number, (timestamp: number) => void>();
  return {
    scheduler: {
      request(callback: (timestamp: number) => void) {
        const handle = next++;
        pending.set(handle, callback);
        return handle;
      },
      cancel(handle: number) {
        pending.delete(handle);
      },
    },
    get pendingCount() {
      return pending.size;
    },
    tick(count = 1) {
      for (let index = 0; index < count; index += 1) {
        now += FRAME_MS;
        const callbacks = [...pending.values()];
        pending.clear();
        for (const callback of callbacks) callback(now);
      }
    },
  };
}

function createLoop(initialLength = 0) {
  const frames = fakeFrames();
  const revealed: number[] = [];
  let settledCount = 0;
  const loop = new StreamingRevealLoop(initialLength, {
    onReveal: (length) => revealed.push(length),
    onSettled: () => (settledCount += 1),
    frames: frames.scheduler,
  });
  return {
    loop,
    frames,
    revealed,
    get settledCount() {
      return settledCount;
    },
  };
}

describe("StreamingRevealLoop", () => {
  it("does not schedule frames while settled", () => {
    const { loop, frames } = createLoop(40);
    loop.setTarget(40);
    assert.equal(frames.pendingCount, 0);
  });

  it("reveals progressively over frames toward the target", () => {
    const { loop, frames, revealed } = createLoop();
    loop.setTarget(200);
    assert.equal(frames.pendingCount, 1);
    frames.tick(3);
    assert.ok(revealed.length > 0);
    const last = revealed.at(-1)!;
    assert.ok(last > 0 && last < 200);
    for (let index = 1; index < revealed.length; index += 1) {
      assert.ok(revealed[index]! > revealed[index - 1]!);
    }
  });

  it("drains a completed source and reports settling once", () => {
    const state = createLoop();
    state.loop.setTarget(300, { done: true });
    state.frames.tick(60);
    assert.equal(state.loop.shownLength, 300);
    assert.equal(state.loop.settled, true);
    assert.equal(state.frames.pendingCount, 0);
    assert.equal(state.settledCount, 1);
  });

  it("snaps immediately and cancels the pending frame", () => {
    const { loop, frames, revealed } = createLoop();
    loop.setTarget(500);
    loop.snap();
    assert.equal(frames.pendingCount, 0);
    assert.equal(loop.shownLength, 500);
    assert.equal(revealed.at(-1), 500);
    loop.snap(20);
    assert.equal(loop.shownLength, 20);
  });

  it("ignores targets after destroy", () => {
    const { loop, frames, revealed } = createLoop();
    loop.setTarget(100);
    loop.destroy();
    assert.equal(frames.pendingCount, 0);
    loop.setTarget(200);
    frames.tick(5);
    assert.deepEqual(revealed, []);
  });
});
