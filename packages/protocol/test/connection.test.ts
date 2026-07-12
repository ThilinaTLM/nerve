import assert from "node:assert/strict";
import test from "node:test";
import { ProtocolConnection, createMessageFactory } from "../src/index.js";
import { ManualTransport } from "./test-runtime.js";

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
