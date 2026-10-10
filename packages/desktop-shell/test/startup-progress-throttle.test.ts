import assert from "node:assert/strict";
import { test } from "node:test";
import { StartupProgressThrottle } from "../src/app/startup-progress-throttle.js";

void test("splash updates are throttled to latest value and cancelled on transition", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const updates: number[] = [];
  const throttle = new StartupProgressThrottle(Date.now, (value: number) =>
    updates.push(value),
  );
  throttle.report(1);
  throttle.report(2);
  throttle.report(3);
  t.mock.timers.tick(249);
  assert.deepEqual(updates, [1]);
  t.mock.timers.tick(1);
  assert.deepEqual(updates, [1, 3]);
  throttle.report(4);
  throttle.cancel();
  t.mock.timers.tick(250);
  assert.deepEqual(updates, [1, 3]);
});
