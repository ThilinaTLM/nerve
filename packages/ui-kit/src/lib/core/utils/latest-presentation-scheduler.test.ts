import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LatestPresentationScheduler,
  type PresentationClock,
} from "./latest-presentation-scheduler.js";

function fakeClock() {
  let now = 0;
  let nextHandle = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock: PresentationClock<number> = {
    now: () => now,
    schedule: (callback, delayMs) => {
      const handle = ++nextHandle;
      timers.set(handle, { at: now + delayMs, callback });
      return handle;
    },
    cancel: (handle) => timers.delete(handle),
  };
  return {
    clock,
    advance(ms: number) {
      now += ms;
      for (const [handle, timer] of [...timers]) {
        if (timer.at > now) continue;
        timers.delete(handle);
        timer.callback();
      }
    },
    timers,
  };
}

describe("LatestPresentationScheduler", () => {
  it("commits first and priority values immediately and coalesces the rest", () => {
    const time = fakeClock();
    const values: string[] = [];
    const scheduler = new LatestPresentationScheduler(
      (value: string) => values.push(value),
      75,
      time.clock,
    );

    scheduler.enqueue("first");
    scheduler.enqueue("second");
    scheduler.enqueue("latest");
    assert.deepEqual(values, ["first"]);
    time.advance(74);
    assert.deepEqual(values, ["first"]);
    time.advance(1);
    assert.deepEqual(values, ["first", "latest"]);

    scheduler.enqueue("newline", { priority: true });
    assert.deepEqual(values, ["first", "latest", "newline"]);
  });

  it("flushes the latest value and cancels pending work on destroy", () => {
    const time = fakeClock();
    const values: number[] = [];
    const scheduler = new LatestPresentationScheduler(
      (value: number) => values.push(value),
      75,
      time.clock,
    );
    scheduler.enqueue(1);
    scheduler.enqueue(2);
    scheduler.flushNow();
    scheduler.enqueue(3);
    scheduler.destroy();
    time.advance(100);

    assert.deepEqual(values, [1, 2]);
    assert.equal(time.timers.size, 0);
  });
});
