import assert from "node:assert/strict";
import { it } from "node:test";
import { LatestSnapshotDelivery } from "../../src/streams/latest-snapshot-delivery.js";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture(
  send?: (value: string) => Promise<void>,
  maxItems = 256,
  maxBytes = 1024,
) {
  let now = 0;
  const timers = new Map<symbol, { at: number; callback: () => void }>();
  const sent: string[] = [];
  const errors: unknown[] = [];
  const delivery = new LatestSnapshotDelivery<string>({
    intervalMs: 50,
    maxItems,
    maxBytes,
    clock: { now: () => now, isoNow: () => new Date(now).toISOString() },
    timers: {
      setTimeout: (callback, delay) => {
        const key = Symbol();
        timers.set(key, { at: now + delay, callback });
        return key;
      },
      clearTimeout: (key) => {
        timers.delete(key as symbol);
      },
      setInterval: () => {
        throw new Error("Unexpected interval");
      },
      clearInterval: () => {},
    },
    send: async (value) => {
      sent.push(value);
      await send?.(value);
    },
    onError: (error) => {
      errors.push(error);
    },
  });
  return {
    delivery,
    sent,
    errors,
    timers,
    advance: async (ms: number) => {
      now += ms;
      for (const [key, timer] of [...timers])
        if (timer.at <= now) {
          timers.delete(key);
          timer.callback();
        }
      await settle();
    },
  };
}

it("sends first and latest trailing prefixes at 50ms, isolating keys with one timer", async () => {
  const f = fixture();
  f.delivery.snapshot("a", "a1", 2);
  await settle();
  assert.deepEqual(f.sent, ["a1"]);
  for (let i = 2; i <= 100; i++) f.delivery.snapshot("a", `a${i}`, 4);
  f.delivery.snapshot("b", "b1", 2);
  await settle();
  assert.equal(f.timers.size, 1);
  await f.advance(49);
  assert.deepEqual(f.sent, ["a1"]);
  await f.advance(1);
  assert.deepEqual(f.sent, ["a1", "a100", "b1"]);
  assert.equal(f.timers.size, 0);
});

it("a slow sender never blocks producers or builds per-prefix promise jobs", async () => {
  let release = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture(() => blocked);
  assert.equal(f.delivery.snapshot("a", "first", 5), undefined);
  await settle();
  for (let i = 0; i < 10000; i++)
    assert.equal(f.delivery.snapshot("a", String(i), 4), undefined);
  await f.advance(500);
  assert.deepEqual(f.sent, ["first"]);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.errors, []);
  release();
  await settle();
  assert.deepEqual(f.sent, ["first", "9999"]);
});

it("terminal fences deliver latest before durable writes, preserving subsequent jobs", async () => {
  const f = fixture();
  f.delivery.snapshot("a", "first", 5);
  await settle();
  f.delivery.snapshot("a", "final", 5);
  f.delivery.fence(
    (key) => key === "a",
    async () => {
      f.sent.push("durable");
    },
    5,
  );
  f.delivery.enqueue(async () => {
    f.sent.push("append1");
  }, 1);
  f.delivery.enqueue(async () => {
    f.sent.push("append2");
  }, 1);
  await settle();
  assert.deepEqual(f.sent, ["first", "final", "durable", "append1", "append2"]);
  await f.advance(100);
  assert.equal(f.sent.length, 5);
});

it("drop invalidates captured and active unsent snapshots; disposal stops further writes", async () => {
  let release = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture(() => blocked);
  f.delivery.snapshot("a", "a", 1);
  f.delivery.snapshot("b", "b", 1);
  await settle();
  f.delivery.snapshot("b", "b2", 2);
  f.delivery.fence(
    (key) => key === "b",
    async () => {
      f.sent.push("terminal");
    },
    1,
  );
  f.delivery.drop((key) => key === "b");
  release();
  await settle();
  assert.deepEqual(f.sent, ["a", "terminal"]);
  f.delivery.snapshot("c", "c", 1);
  await settle();
  f.delivery.dispose();
  await f.advance(100);
  f.delivery.snapshot("d", "d", 1);
  f.delivery.enqueue(async () => {
    f.sent.push("late");
  }, 1);
  await settle();
  assert.deepEqual(f.sent, ["a", "terminal"]);
});

it("bounds ordered work and snapshot bytes, including in-flight work", async () => {
  const jobs = fixture(() => new Promise(() => {}), 3);
  jobs.delivery.snapshot("a", "blocked", 1);
  await settle();
  for (let i = 0; i < 4; i++) jobs.delivery.enqueue(async () => {}, 1);
  assert.equal(jobs.errors.length, 1);
  const bytes = fixture(undefined, 256, 5);
  bytes.delivery.snapshot("a", "123456", 6);
  await settle();
  assert.equal(bytes.errors.length, 1);
  assert.deepEqual(bytes.sent, []);
});

it("scheduled keys select the latest value after another call's slow send", async () => {
  let release = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture((value) => (value === "a" ? blocked : Promise.resolve()));
  f.delivery.snapshot("a", "a", 1);
  f.delivery.snapshot("b", "old-b", 5);
  await settle();
  f.delivery.snapshot("b", "latest-b", 8);
  release();
  await settle();
  assert.deepEqual(f.sent, ["a", "latest-b"]);
});

it("sender failure stops queued writes and cancels future snapshots", async () => {
  const error = new Error("closed transport");
  const f = fixture(async () => {
    throw error;
  });
  f.delivery.snapshot("a", "first", 5);
  f.delivery.snapshot("b", "unsent", 6);
  await settle();
  f.delivery.snapshot("a", "late", 4);
  await f.advance(100);
  assert.deepEqual(f.errors, [error]);
  assert.deepEqual(f.sent, ["first"]);
  assert.equal(f.timers.size, 0);
});
