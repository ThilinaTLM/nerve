import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FrameCoalescer } from "./frame-coalescer";

function scheduler() {
  let nextHandle = 0;
  const callbacks = new Map<number, () => void>();
  const cancelled: number[] = [];
  return {
    schedule(callback: () => void): number {
      nextHandle += 1;
      callbacks.set(nextHandle, callback);
      return nextHandle;
    },
    cancel(handle: number): void {
      callbacks.delete(handle);
      cancelled.push(handle);
    },
    run(handle = nextHandle): void {
      const callback = callbacks.get(handle);
      callbacks.delete(handle);
      callback?.();
    },
    callbacks,
    cancelled,
  };
}

describe("FrameCoalescer", () => {
  it("commits only the latest value from one scheduled frame", () => {
    const frames = scheduler();
    const committed: number[] = [];
    const coalescer = new FrameCoalescer(
      (value: number) => committed.push(value),
      frames.schedule,
      frames.cancel,
    );

    coalescer.enqueue(1);
    coalescer.enqueue(2);
    coalescer.enqueue(3);

    assert.equal(frames.callbacks.size, 1);
    frames.run();
    assert.deepEqual(committed, [3]);
  });

  it("flushes immediately and cancels stale scheduled work", () => {
    const frames = scheduler();
    const committed: string[] = [];
    const coalescer = new FrameCoalescer(
      (value: string) => committed.push(value),
      frames.schedule,
      frames.cancel,
    );

    coalescer.enqueue("old");
    coalescer.flushNow("current");

    assert.deepEqual(committed, ["current"]);
    assert.deepEqual(frames.cancelled, [1]);
    frames.run(1);
    assert.deepEqual(committed, ["current"]);
  });

  it("holds hidden updates until an explicit flush", () => {
    const frames = scheduler();
    const committed: number[] = [];
    const coalescer = new FrameCoalescer(
      (value: number) => committed.push(value),
      frames.schedule,
      frames.cancel,
    );

    coalescer.hold(1);
    coalescer.hold(2);
    assert.equal(frames.callbacks.size, 0);
    assert.deepEqual(committed, []);

    coalescer.flushNow();
    assert.deepEqual(committed, [2]);
  });

  it("prevents callbacks after destroy", () => {
    const frames = scheduler();
    const committed: number[] = [];
    const coalescer = new FrameCoalescer(
      (value: number) => committed.push(value),
      frames.schedule,
      frames.cancel,
    );

    coalescer.enqueue(1);
    coalescer.destroy();
    frames.run();
    coalescer.enqueue(2);

    assert.deepEqual(committed, []);
    assert.equal(frames.callbacks.size, 0);
  });
});
