import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { subscribeClock } from "./clock-ticker";

test("subscribers of one interval share a timer that stops with the last one", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  const setIntervalSpy = mock.method(globalThis, "setInterval");
  const a: number[] = [];
  const b: number[] = [];
  const offA = subscribeClock(1000, (n) => a.push(n));
  const offB = subscribeClock(1000, (n) => b.push(n));
  assert.equal(setIntervalSpy.mock.callCount(), 1);

  t.mock.timers.tick(1000);
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);

  offA();
  t.mock.timers.tick(1000);
  assert.equal(a.length, 1);
  assert.equal(b.length, 2);

  offB();
  t.mock.timers.tick(5000);
  assert.equal(b.length, 2);

  subscribeClock(1000, () => {})();
  assert.equal(setIntervalSpy.mock.callCount(), 2);
  setIntervalSpy.mock.restore();
});
