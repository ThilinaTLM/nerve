import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { TaskRecord } from "@nervekit/contracts";
import { WorkbenchTaskService } from "../src/domains/tasks/workbench-task-service.js";
import { EventBus } from "../src/infrastructure/events/index.js";
import { readJsonFile } from "../src/infrastructure/storage/index.js";
import {
  createManager,
  fakeChild,
  fakeSupervisor,
  runtimeMetadata,
  startFakeTask,
} from "./helpers/workbench-task-service.js";

describe("task manager cancel lifecycle", () => {
  it("does not terminalize when the child never closes", async () => {
    const child = fakeChild();
    const { supervisor, terminateSignals } = fakeSupervisor({ child });
    const { manager, storage } = await createManager(supervisor);
    const task = await startFakeTask(manager, storage);

    const startedAt = Date.now();
    const stopped = await manager.cancelTask(task.id, { timeoutMs: 20 });

    assert.ok(Date.now() - startedAt < 500);
    assert.equal(stopped.status, "stopping");
    assert.equal(stopped.exitCode, undefined);
    assert.equal(stopped.signal, undefined);
    assert.deepEqual(terminateSignals, ["SIGTERM", "SIGKILL"]);
  });

  it("uses late close evidence to finalize a pending cancellation", async () => {
    const child = fakeChild();
    const { supervisor } = fakeSupervisor({ child });
    const { manager, storage } = await createManager(supervisor);
    const task = await startFakeTask(manager, storage);

    const stopped = await manager.cancelTask(task.id, { timeoutMs: 20 });
    child.emitClose(1, null);
    await delay(0);

    const stored = manager.getTask(stopped.id);
    assert.equal(stored.status, "cancelled");
    assert.equal(stored.exitCode, 1);
    assert.equal(stored.signal, null);
  });

  it("returns a cancelled record when the child closes normally", async () => {
    const child = fakeChild();
    const { supervisor, terminateSignals } = fakeSupervisor({
      child,
      onTerminate(signal) {
        if (signal === "SIGTERM") child.emitClose(0, "SIGTERM");
      },
    });
    const { manager, storage } = await createManager(supervisor);
    const task = await startFakeTask(manager, storage);

    const stopped = await manager.cancelTask(task.id, { timeoutMs: 1000 });

    assert.equal(stopped.status, "cancelled");
    assert.equal(stopped.exitCode, 0);
    assert.equal(stopped.signal, "SIGTERM");
    assert.deepEqual(terminateSignals, ["SIGTERM"]);
  });

  it("is idempotent while cancellation is awaiting exit evidence", async () => {
    const child = fakeChild();
    const { supervisor, terminateSignals } = fakeSupervisor({ child });
    const { manager, storage } = await createManager(supervisor);
    const task = await startFakeTask(manager, storage);

    const stopped = await manager.cancelTask(task.id, { timeoutMs: 20 });
    const again = await manager.cancelTask(task.id, { timeoutMs: 20 });

    assert.equal(again.id, stopped.id);
    assert.equal(again.status, "stopping");
    assert.deepEqual(terminateSignals, ["SIGTERM", "SIGKILL"]);
  });
});

describe("task manager active restart lifecycle", () => {
  it("creates restart lineage and keeps the replacement independent", async () => {
    const firstChild = fakeChild(1234);
    const secondChild = fakeChild(5678);
    const replacementRuntime = runtimeMetadata({
      childPid: 5678,
      processGroupId: 5678,
      spawnedAt: "2026-01-02T03:05:05.000Z",
    });
    const { supervisor } = fakeSupervisor({
      child: [firstChild, secondChild],
      runtime: [runtimeMetadata({ childPid: 1234 }), replacementRuntime],
    });
    const { manager, storage } = await createManager(supervisor);
    const task = await startFakeTask(manager, storage);
    const oldManaged = manager.managed.get(task.id);
    assert.ok(oldManaged);
    oldManaged.closePromise = Promise.resolve({
      exitCode: 0,
      signal: "SIGTERM",
    });

    const restarted = await manager.restartTask(task.id);
    firstChild.emitClose(1, null);
    await delay(0);

    const current = manager.getTask(restarted.id);
    assert.notEqual(restarted.id, task.id);
    assert.equal(current.status, "running");
    assert.deepEqual(current.runtime, replacementRuntime);
    assert.equal(current.restartedFromTaskId, task.id);
    assert.equal(current.restartRootTaskId, task.id);
  });
});

describe("task manager runtime metadata", () => {
  it("persists runtime metadata when starting a task", async () => {
    const runtime = runtimeMetadata({ childPid: 4321, processGroupId: 4321 });
    const { supervisor } = fakeSupervisor({ child: fakeChild(4321), runtime });
    const { manager, storage } = await createManager(supervisor);

    const task = await startFakeTask(manager, storage);
    const persisted = await readJsonFile<TaskRecord>(
      join(storage.paths.home, "tasks", task.id, "task.json"),
    );

    assert.deepEqual(manager.getTask(task.id).runtime, runtime);
    assert.deepEqual(persisted.runtime, runtime);
  });

  it("hydrates live but unsupervised persisted records as orphaned", async () => {
    const runtime = runtimeMetadata({ childPid: 4321, processGroupId: 4321 });
    const { supervisor } = fakeSupervisor({ child: fakeChild(4321), runtime });
    const { manager, storage, index, launchConfigs } =
      await createManager(supervisor);
    const task = await startFakeTask(manager, storage);

    const hydrated = new WorkbenchTaskService(
      storage,
      new EventBus(storage.paths.home, index),
      index,
      undefined,
      {
        supervisor: fakeSupervisor({
          runtime,
          isRuntimeTargetAlive: () => true,
        }).supervisor,
        launchConfigs,
      },
    );
    await hydrated.hydrate();

    const record = hydrated.getTask(task.id);
    assert.equal(record.status, "orphaned");
    assert.deepEqual(record.runtime, runtime);
    assert.match(record.error ?? "", /task_cancel/);
  });
});

describe("task manager notifications", () => {
  it("defaults notifications on for conversation tasks and honors explicit opt-out", async () => {
    const { supervisor } = fakeSupervisor({ child: fakeChild() });
    const { manager, storage } = await createManager(supervisor);

    const defaulted = await startFakeTask(manager, storage, undefined, {
      agentId: "agent_test",
      conversationId: "conv_test",
    });
    const optedOut = await startFakeTask(manager, storage, undefined, {
      agentId: "agent_test",
      conversationId: "conv_test",
      notify: false,
    });

    assert.equal(defaulted.notifications?.enabled, true);
    assert.equal(defaulted.notifications?.ready, true);
    assert.equal(defaulted.notifications?.terminal, true);
    assert.equal(optedOut.notifications?.enabled, false);
    assert.equal(optedOut.notifications?.ready, false);
    assert.equal(optedOut.notifications?.terminal, false);
  });
});
