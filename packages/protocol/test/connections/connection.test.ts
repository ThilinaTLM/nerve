import assert from "node:assert/strict";
import test from "node:test";
import { ProtocolConnection, createMessageFactory } from "../../src/index.js";
import { ManualTransport } from "../test-runtime.js";

const messages = createMessageFactory({
  source: { role: "ui", id: "ui_connection" },
  target: { role: "workbench_server", id: "server_connection" },
});
const hello = () =>
  messages("hello", {
    requestedVersion: 1,
    capabilities: [],
    encodings: ["json"],
  }) as never;
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("connection applies asynchronous inbound messages strictly in wire order", async () => {
  const transport = new ManualTransport();
  const gate = deferred();
  const order: string[] = [];
  const first = hello();
  const second = hello();
  const connection = new ProtocolConnection({
    transport,
    onMessage: async (message) => {
      order.push(`start:${message.id}`);
      if (message.id === first.id) await gate.promise;
      order.push(`end:${message.id}`);
    },
  });
  void transport.emit(first);
  void transport.emit(second);
  await tick();
  assert.deepEqual(order, [`start:${first.id}`]);
  gate.resolve();
  await tick();
  await tick();
  assert.deepEqual(order, [
    `start:${first.id}`,
    `end:${first.id}`,
    `start:${second.id}`,
    `end:${second.id}`,
  ]);
  connection.dispose();
});

test("handler failure is reported and does not poison the inbound queue", async () => {
  const transport = new ManualTransport();
  const handled: string[] = [];
  const errors: string[] = [];
  const bad = hello();
  const good = hello();
  new ProtocolConnection({
    transport,
    onMessage: (message) => {
      if (message.id === bad.id) throw new Error("handler failed");
      handled.push(message.id);
    },
    onError: (error) => errors.push((error as Error).message),
  });
  void transport.emit(bad);
  void transport.emit(good);
  await tick();
  await tick();
  assert.deepEqual(errors, ["handler failed"]);
  assert.deepEqual(handled, [good.id]);
});

test("disposal aborts and drains an in-flight application before later work", async () => {
  const transport = new ManualTransport();
  const gate = deferred();
  const commits: string[] = [];
  let observedAbort = false;
  const first = hello();
  const connection = new ProtocolConnection({
    transport,
    onMessage: async (message, context) => {
      await gate.promise;
      observedAbort = context.signal.aborted;
      if (!context.signal.aborted) commits.push(message.id);
    },
  });
  void transport.emit(first);
  await tick();
  connection.dispose();
  let drained = false;
  const draining = connection.drain().then(() => {
    drained = true;
  });
  await tick();
  assert.equal(drained, false);
  gate.resolve();
  await draining;
  assert.equal(observedAbort, true);
  assert.deepEqual(commits, []);
});

test("disposal prevents stale queued frames from applying", async () => {
  const transport = new ManualTransport();
  const gate = deferred();
  const handled: string[] = [];
  const first = hello();
  const stale = hello();
  const connection = new ProtocolConnection({
    transport,
    onMessage: async (message) => {
      handled.push(message.id);
      if (message.id === first.id) await gate.promise;
    },
  });
  void transport.emit(first);
  void transport.emit(stale);
  await tick();
  connection.dispose();
  gate.resolve();
  await tick();
  await tick();
  assert.deepEqual(handled, [first.id]);
});

function fakeClock() {
  let nextId = 0;
  const pending = new Map<number, { at: number; run: () => void }>();
  let now = 0;
  return {
    timers: {
      setTimeout: (run: () => void, ms: number) => {
        pending.set(++nextId, { at: now + ms, run });
        return nextId;
      },
      clearTimeout: (handle: unknown) => void pending.delete(handle as number),
    },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...pending]) {
        if (timer.at <= now) {
          pending.delete(id);
          timer.run();
        }
      }
    },
  };
}

test("slow handler is reported once while ordering is preserved", async () => {
  const transport = new ManualTransport();
  const clock = fakeClock();
  const gate = deferred();
  const errors: string[] = [];
  const first = hello();
  const connection = new ProtocolConnection({
    transport,
    timers: clock.timers,
    slowHandlerMs: 100,
    onMessage: () => gate.promise,
    onError: (error) => errors.push((error as Error).message),
  });
  void transport.emit(first);
  await tick();
  clock.advance(99);
  await tick();
  assert.deepEqual(errors, []);
  clock.advance(1);
  clock.advance(500);
  await tick();
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /exceeded 100ms/);
  gate.resolve();
  await tick();
  connection.dispose();
});

test("close returns within the drain bound when a handler hangs", async () => {
  const transport = new ManualTransport();
  const clock = fakeClock();
  const errors: string[] = [];
  const connection = new ProtocolConnection({
    transport,
    timers: clock.timers,
    drainTimeoutMs: 1000,
    slowHandlerMs: 60_000,
    onMessage: () => new Promise<void>(() => undefined),
    onError: (error) => errors.push((error as Error).message),
  });
  void transport.emit(hello());
  await tick();
  let closed = false;
  const closing = connection.close().then(() => {
    closed = true;
  });
  await tick();
  assert.equal(closed, false);
  clock.advance(1000);
  await closing;
  assert.equal(closed, true);
  assert.match(errors.join(), /drain timed out after 1000ms/);
});
