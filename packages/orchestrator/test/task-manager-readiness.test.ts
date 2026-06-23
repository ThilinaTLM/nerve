import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  closeServer,
  createManager,
  fakeChild,
  fakeSupervisor,
  listen,
  startFakeTask,
  waitForTaskEvent,
} from "./helpers/task-manager.js";

describe("task manager log buffering and readiness", () => {
  it("keeps readiness checks off unless a readiness signal is configured", async () => {
    const { supervisor } = fakeSupervisor({ child: fakeChild() });
    const { manager, storage } = await createManager(supervisor);

    const task = await startFakeTask(manager, storage, undefined, {
      readyTimeoutMs: 20,
    });
    await delay(40);

    assert.equal(manager.getTask(task.id).readiness.outcome, "none");
  });

  it("marks explicit readiness timeout without stopping the task", async () => {
    const { supervisor } = fakeSupervisor({ child: fakeChild() });
    const { manager, storage, events } = await createManager(supervisor);
    const timeoutEvent = waitForTaskEvent(events, "task.ready_timeout");

    const task = await startFakeTask(manager, storage, undefined, {
      readyPattern: "never ready",
      readyTimeoutMs: 20,
    });
    const timedOut = await timeoutEvent;

    assert.equal(timedOut.id, task.id);
    assert.equal(timedOut.status, "running");
    assert.equal(timedOut.readiness.outcome, "timeout");
    assert.equal(timedOut.readiness.timeoutMs, 20);
  });

  it("matches readyPattern across stdout chunks", async () => {
    const child = fakeChild();
    const { supervisor } = fakeSupervisor({ child });
    const { manager, storage, events } = await createManager(supervisor);
    const startedEvent = waitForTaskEvent(events, "task.started");

    const start = startFakeTask(manager, storage, undefined, {
      readyPattern: "ready on port 5173",
      readyTimeoutMs: 1000,
    });
    const started = await startedEvent;
    const readyEvent = waitForTaskEvent(events, "task.ready", started.id);
    child.stdout.emit("data", "server ready on ");
    child.stdout.emit("data", "port 5173\n");

    await start;
    await readyEvent;
    const task = manager.getTask(started.id);
    const logs = await manager.queryLogs(started.id);

    assert.equal(task.readiness.outcome, "ready");
    assert.equal(task.readiness.matched, "ready on port 5173");
    assert.deepEqual(
      logs.events.map((event) => event.line),
      ["server ready on port 5173"],
    );
  });

  it("matches readyOnUrl across stdout chunks", async () => {
    const child = fakeChild();
    const { supervisor } = fakeSupervisor({ child });
    const { manager, storage, events } = await createManager(supervisor);
    const startedEvent = waitForTaskEvent(events, "task.started");

    const start = startFakeTask(manager, storage, undefined, {
      readyOnUrl: true,
      readyTimeoutMs: 1000,
    });
    const started = await startedEvent;
    const readyEvent = waitForTaskEvent(events, "task.ready", started.id);
    child.stdout.emit("data", "Listening at http://localhost:");
    child.stdout.emit("data", "5173\n");

    await start;
    await readyEvent;
    const task = manager.getTask(started.id);

    assert.equal(task.readiness.outcome, "ready");
    assert.equal(task.readiness.matched, "http://localhost:5173");
  });

  it("polls readyUrl and marks the task ready on any HTTP response", async () => {
    const child = fakeChild();
    const { supervisor } = fakeSupervisor({ child });
    const { manager, storage, events } = await createManager(supervisor);
    const server = createServer((_request, response) => {
      response.statusCode = 503;
      response.end("not yet, but reachable");
    });
    await listen(server);
    try {
      const address = server.address() as AddressInfo;
      const readyUrl = `http://127.0.0.1:${address.port}/health`;
      const readyEvent = waitForTaskEvent(events, "task.ready");

      await startFakeTask(manager, storage, undefined, {
        readyUrl,
        readyTimeoutMs: 2000,
      });
      const ready = await readyEvent;

      assert.equal(ready.status, "ready");
      assert.equal(ready.readiness.outcome, "ready");
      assert.equal(ready.readiness.readyUrl, readyUrl);
      assert.equal(ready.readiness.matched, readyUrl);
    } finally {
      await closeServer(server);
    }
  });

  it("uses final flush to satisfy readiness before exit", async () => {
    const child = fakeChild();
    const { supervisor } = fakeSupervisor({ child });
    const { manager, storage, events } = await createManager(supervisor);
    const startedEvent = waitForTaskEvent(events, "task.started");

    const start = startFakeTask(manager, storage, undefined, {
      readyPattern: "final ready",
      readyTimeoutMs: 1000,
    });
    const started = await startedEvent;
    const exitedEvent = waitForTaskEvent(events, "task.completed", started.id);
    child.stdout.emit("data", "final ready");
    child.emitClose(0, null);

    await start;
    await exitedEvent;
    const stored = manager.getTask(started.id);

    assert.equal(stored.status, "completed");
    assert.equal(stored.readiness.outcome, "ready");
    assert.equal(stored.readiness.matched, "final ready");
  });

  it("flushes buffered stderr before marking task error", async () => {
    const child = fakeChild();
    const { supervisor } = fakeSupervisor({ child });
    const { manager, storage, events } = await createManager(supervisor);
    const task = await startFakeTask(manager, storage);
    const errorEvent = waitForTaskEvent(events, "task.failed", task.id);

    child.stderr.emit("data", "fatal failure");
    child.emit("error", new Error("boom"));
    await errorEvent;

    const logs = await manager.queryLogs(task.id, { mode: "errors" });
    assert.deepEqual(
      logs.events.map((event) => event.line),
      ["fatal failure"],
    );
  });

  it("flushes buffered output during force-finalized stop", async () => {
    const child = fakeChild();
    const { supervisor } = fakeSupervisor({ child });
    const { manager, storage } = await createManager(supervisor);
    const task = await startFakeTask(manager, storage);

    child.stdout.emit("data", "stopping output");
    const stopped = await manager.cancelTask(task.id, { timeoutMs: 20 });

    const logs = await manager.queryLogs(task.id);
    assert.equal(stopped.status, "cancelled");
    assert.deepEqual(
      logs.events.map((event) => event.line),
      ["stopping output"],
    );
  });
});

describe("task manager runtime timeout", () => {
  it("uses timed_out status when runtime timeout termination closes the child", async () => {
    const child = fakeChild();
    const { supervisor, terminateSignals } = fakeSupervisor({
      child,
      onTerminate(signal) {
        if (signal === "SIGTERM") child.emitClose(null, signal);
      },
    });
    const { manager, storage, events } = await createManager(supervisor);
    const timedOutEvent = waitForTaskEvent(events, "task.timed_out");

    const task = await startFakeTask(manager, storage, undefined, {
      timeoutMs: 20,
    });
    const timedOut = await timedOutEvent;

    assert.equal(timedOut.id, task.id);
    assert.equal(timedOut.status, "timed_out");
    assert.equal(timedOut.signal, "SIGTERM");
    assert.match(timedOut.error ?? "", /maximum runtime/);
    assert.deepEqual(terminateSignals, ["SIGTERM"]);
  });
});
