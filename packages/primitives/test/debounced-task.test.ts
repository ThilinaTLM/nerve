import assert from "node:assert/strict";
import { test } from "node:test";
import { createDebouncedTask, type DebounceClock } from "../src/index.ts";

function manualClock() {
  let next = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let now = 0;
  const clock: DebounceClock = {
    setTimeout: (callback, delay) => {
      timers.set(next, { at: now + delay, callback });
      return next++;
    },
    clearTimeout: (handle) => void timers.delete(handle as number),
  };
  return {
    clock,
    size: () => timers.size,
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers])
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
    },
  };
}

test("runs once, ms after the last schedule", () => {
  const time = manualClock();
  let runs = 0;
  const task = createDebouncedTask(() => runs++, 100, time.clock);
  task.schedule();
  time.advance(60);
  task.schedule();
  time.advance(60);
  assert.equal(runs, 0);
  assert.equal(task.pending, true);
  time.advance(40);
  assert.equal(runs, 1);
  assert.equal(task.pending, false);
});

test("flush runs a pending task immediately and clears the timer", () => {
  const time = manualClock();
  let runs = 0;
  const task = createDebouncedTask(() => runs++, 100, time.clock);
  assert.equal(task.flush(), false);
  task.schedule();
  assert.equal(task.flush(), true);
  assert.equal(runs, 1);
  assert.equal(time.size(), 0);
  time.advance(200);
  assert.equal(runs, 1);
});

test("cancel drops the pending run", () => {
  const time = manualClock();
  let runs = 0;
  const task = createDebouncedTask(() => runs++, 100, time.clock);
  task.schedule();
  task.cancel();
  time.advance(200);
  assert.equal(runs, 0);
  assert.equal(task.pending, false);
});

test("fn may reschedule itself", () => {
  const time = manualClock();
  let runs = 0;
  const task = createDebouncedTask(
    () => {
      runs++;
      if (runs < 2) task.schedule();
    },
    10,
    time.clock,
  );
  task.schedule();
  time.advance(10);
  time.advance(10);
  assert.equal(runs, 2);
});

test("uses the system clock by default", async () => {
  let runs = 0;
  const task = createDebouncedTask(() => runs++, 5);
  task.schedule();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(runs, 1);
});
