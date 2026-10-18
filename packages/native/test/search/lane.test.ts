import assert from "node:assert/strict";
import test from "node:test";
import { createLane } from "../../src/search/lane.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
test("bounded lane preserves FIFO and resumes after a failed operation", async () => {
  const first = deferred<void>();
  const order: number[] = [];
  const lane = createLane({ close: async () => undefined });
  const active = lane.run(async () => {
    await first.promise;
    order.push(0);
  });
  const failed = assert.rejects(
    lane.run(async () => {
      order.push(1);
      throw new Error("synthetic");
    }),
    /synthetic/,
  );
  const last = lane.run(async () => {
    order.push(2);
    return 42;
  });
  first.resolve();
  await active;
  await failed;
  assert.equal(await last, 42);
  assert.deepEqual(order, [0, 1, 2]);
  await lane.close();
});
test("close signals preparation immediately, revokes waiters and awaits active work/disposal", async () => {
  const activeDone = deferred<void>();
  const disposalDone = deferred<void>();
  let closes = 0;
  const lane = createLane({
    close: () => {
      closes++;
      return disposalDone.promise;
    },
  });
  const active = lane.run(() => activeDone.promise);
  const waiters = Array.from({ length: 32 }, () =>
    assert.rejects(
      lane.run(async () => undefined),
      /closed/,
    ),
  );
  await assert.rejects(
    lane.run(async () => undefined),
    /queue is full/,
  );
  let finished = false;
  const closing = lane.close().then(() => {
    finished = true;
  });
  assert.ok(lane.signal.aborted);
  await Promise.all(waiters);
  disposalDone.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  activeDone.resolve();
  await active;
  await closing;
  await lane.close();
  assert.equal(closes, 1);
  await assert.rejects(
    lane.run(async () => undefined),
    /closed/,
  );
});
