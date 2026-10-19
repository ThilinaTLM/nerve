import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { acquireBuildSlot } from "../../src/search/admission.js";

test("process-wide update admission bounds waiters, removes aborts and releases slots once", async () => {
  const releases = [await acquireBuildSlot(), await acquireBuildSlot()];
  const controller = new AbortController();
  const cancelled = assert.rejects(
    acquireBuildSlot(controller.signal),
    /abort/i,
  );
  const entered: number[] = [];
  const waiters = Array.from({ length: 15 }, (_, i) =>
    acquireBuildSlot().then((release) => {
      entered.push(i);
      releases.push(release);
      return release;
    }),
  );
  try {
    await assert.rejects(acquireBuildSlot(), /build queue is full/);
    controller.abort();
    await cancelled;
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    waiters.push(
      acquireBuildSlot().then((release) => {
        entered.push(15);
        releases.push(release);
        return release;
      }),
    );
    await assert.rejects(acquireBuildSlot(), /build queue is full/);
    releases[0]!();
    releases[0]!();
    await waiters[0];
    assert.deepEqual(entered, [0], "double release must not admit extra work");
    for (const waiter of waiters) (await waiter)();
    assert.deepEqual(
      entered,
      Array.from({ length: 16 }, (_, i) => i),
    );
  } finally {
    controller.abort();
    for (const release of releases) release();
  }
  const release = await acquireBuildSlot();
  release();
});
