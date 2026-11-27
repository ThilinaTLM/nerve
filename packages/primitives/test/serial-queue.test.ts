import assert from "node:assert/strict";
import { test } from "node:test";
import { KeyedSerialQueue, SerialQueue } from "../src/index.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

test("runs tasks one at a time in call order", async () => {
  const queue = new SerialQueue();
  const log: string[] = [];
  const gate = deferred();
  const first = queue.run(async () => {
    log.push("a:start");
    await gate.promise;
    log.push("a:end");
    return 1;
  });
  const second = queue.run(() => {
    log.push("b");
    return 2;
  });
  await tick();
  assert.deepEqual(log, ["a:start"]);
  assert.equal(queue.busy, true);
  gate.resolve();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(log, ["a:start", "a:end", "b"]);
  await queue.idle();
  assert.equal(queue.busy, false);
});

test("isolate: a failure rejects only its caller and later tasks run", async () => {
  const queue = new SerialQueue();
  const failed = queue.run(() => Promise.reject(new Error("boom")));
  const next = queue.run(() => "ok");
  await assert.rejects(failed, /boom/);
  assert.equal(await next, "ok");
  await queue.idle();
});

test("a synchronous throw is a rejection and does not break the queue", async () => {
  const queue = new SerialQueue();
  await assert.rejects(
    queue.run(() => {
      throw new Error("sync");
    }),
    /sync/,
  );
  assert.equal(await queue.run(() => 3), 3);
});

test("halt: later tasks reject with the first failure without running until reset", async () => {
  const queue = new SerialQueue({ onError: "halt" });
  let ran = false;
  const failed = queue.run(() => Promise.reject(new Error("first")));
  const skipped = queue.run(() => {
    ran = true;
  });
  await assert.rejects(failed, /first/);
  await assert.rejects(skipped, /first/);
  assert.equal(ran, false);
  queue.reset();
  assert.equal(await queue.run(() => "again"), "again");
});

test("keyed queues serialize per key and run keys concurrently", async () => {
  const queue = new KeyedSerialQueue<string>();
  const log: string[] = [];
  const gate = deferred();
  const a1 = queue.run("a", async () => {
    log.push("a1:start");
    await gate.promise;
    log.push("a1:end");
  });
  const a2 = queue.run("a", () => void log.push("a2"));
  const b = queue.run("b", () => void log.push("b"));
  await b;
  assert.deepEqual(log, ["a1:start", "b"]);
  gate.resolve();
  await Promise.all([a1, a2]);
  assert.deepEqual(log, ["a1:start", "b", "a1:end", "a2"]);
});

test("keyed queue recovers after a failure and releases idle keys", async () => {
  const queue = new KeyedSerialQueue<string>();
  const failed = queue.run("k", () => Promise.reject(new Error("nope")));
  const next = queue.run("k", () => "fine");
  await assert.rejects(failed, /nope/);
  assert.equal(await next, "fine");
  await queue.idle("k");
  await tick();
  assert.equal(queue.size, 0);
  await queue.idle("missing");
});
