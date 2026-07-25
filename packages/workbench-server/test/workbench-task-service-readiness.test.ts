import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import {
  closeServer,
  createManager,
  fakeChild,
  fakeSupervisor,
  listen,
  startFakeTask,
  waitForTaskEvent,
} from "./helpers/workbench-task-service.js";

describe("task manager log buffering and readiness", () => {
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
});
