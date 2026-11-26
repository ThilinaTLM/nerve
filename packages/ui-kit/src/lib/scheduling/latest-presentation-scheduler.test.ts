import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createManualTimerCore } from "@nervekit/test-kit";
import {
  LatestPresentationScheduler,
  type PresentationClock,
} from "./latest-presentation-scheduler.js";

function fakeClock() {
  const timers = createManualTimerCore();
  const clock: PresentationClock<number> = {
    now: timers.now,
    schedule: timers.setTimeout,
    cancel: timers.clearTimeout,
  };
  return { clock, advance: timers.advance, pending: timers.pending };
}

describe("LatestPresentationScheduler", () => {
  it("commits first and priority values immediately and coalesces the rest", async () => {
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
    await time.advance(74);
    assert.deepEqual(values, ["first"]);
    await time.advance(1);
    assert.deepEqual(values, ["first", "latest"]);

    scheduler.enqueue("newline", { priority: true });
    assert.deepEqual(values, ["first", "latest", "newline"]);
  });

  it("flushes the latest value and cancels pending work on destroy", async () => {
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
    await time.advance(100);

    assert.deepEqual(values, [1, 2]);
    assert.equal(time.pending(), 0);
  });
});
