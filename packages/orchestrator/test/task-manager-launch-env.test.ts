import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { TaskManager } from "../src/domains/tasks/task-manager.js";
import { EventBus } from "../src/infrastructure/events/index.js";
import { readJsonFile } from "../src/infrastructure/storage/index.js";
import {
  createManager,
  fakeChild,
  fakeSupervisor,
  runtimeMetadata,
  startFakeTask,
} from "./helpers/task-manager.js";

describe("task manager launch env", () => {
  it("stores env config-side and exposes only redacted envInfo", async () => {
    const env = { PORT: "4321", API_TOKEN: "secret" };
    const { supervisor, spawnCalls } = fakeSupervisor({});
    const { manager, storage, events, launchConfigs } =
      await createManager(supervisor);

    const task = await startFakeTask(manager, storage, env);
    const persisted = await readJsonFile<Record<string, unknown>>(
      join(storage.paths.home, "tasks", task.id, "task.json"),
    );
    const launchConfig = await launchConfigs.read(task.id);

    assert.deepEqual(spawnCalls[0]?.options.env, env);
    assert.deepEqual(task.envInfo, {
      keys: ["API_TOKEN", "PORT"],
      persisted: true,
      redacted: true,
    });
    assert.equal("env" in task, false);
    assert.equal("env" in persisted, false);
    assert.deepEqual(launchConfig?.env, env);
    assert.equal(
      JSON.stringify(events.replaySince(0)).includes("secret"),
      false,
    );
  });

  it("passes stored env to replacement spawn on restart", async () => {
    const env = { PORT: "4321", API_TOKEN: "secret" };
    const child = fakeChild();
    const { supervisor, spawnCalls } = fakeSupervisor({
      child,
      onTerminate(signal) {
        if (signal === "SIGTERM") child.emitClose(0, signal);
      },
    });
    const { manager, storage } = await createManager(supervisor);
    const task = await startFakeTask(manager, storage, env);
    await manager.cancelTask(task.id);

    const restarted = await manager.restartTask(task.id);

    assert.equal(spawnCalls.length, 2);
    assert.deepEqual(spawnCalls[1]?.options.env, env);
    assert.equal(restarted.restartedFromTaskId, task.id);
    assert.deepEqual(restarted.envInfo, {
      keys: ["API_TOKEN", "PORT"],
      persisted: true,
      redacted: true,
    });
    assert.equal("env" in restarted, false);
  });

  it("records restart lineage metadata", async () => {
    const child = fakeChild();
    const { supervisor } = fakeSupervisor({
      child,
      onTerminate(signal) {
        if (signal === "SIGTERM") child.emitClose(0, signal);
      },
    });
    const { manager, storage } = await createManager(supervisor);
    const task = await startFakeTask(manager, storage);
    await manager.cancelTask(task.id);

    const firstRestart = await manager.restartTask(task.id);
    await manager.cancelTask(firstRestart.id);
    const secondRestart = await manager.restartTask(firstRestart.id);

    assert.equal(task.restartRootTaskId, task.id);
    assert.equal(task.restartGeneration, 0);
    assert.equal(firstRestart.restartRootTaskId, task.id);
    assert.equal(firstRestart.restartGeneration, 1);
    assert.equal(secondRestart.restartRootTaskId, task.id);
    assert.equal(secondRestart.restartGeneration, 2);
  });

  it("loads restart env before stopping an active task", async () => {
    const env = { API_TOKEN: "secret" };
    const { supervisor, terminateSignals, spawnCalls } = fakeSupervisor({});
    const { manager, storage, launchConfigs } = await createManager(supervisor);
    const task = await startFakeTask(manager, storage, env);
    await launchConfigs.remove(task.id);

    await assert.rejects(
      () => manager.restartTask(task.id),
      /launch env is missing/,
    );

    assert.deepEqual(terminateSignals, []);
    assert.equal(spawnCalls.length, 1);
    assert.equal(manager.getTask(task.id).status, "running");
  });

  it("loads restart env before cleaning an orphaned task", async () => {
    const runtime = runtimeMetadata({ childPid: 4321, processGroupId: 4321 });
    const { supervisor: firstSupervisor } = fakeSupervisor({ runtime });
    const { manager, storage, index, launchConfigs } =
      await createManager(firstSupervisor);
    const task = await startFakeTask(manager, storage, {
      API_TOKEN: "secret",
    });
    await launchConfigs.remove(task.id);

    const { supervisor, runtimeTerminateSignals, spawnCalls } = fakeSupervisor({
      runtime,
      isRuntimeTargetAlive: () => false,
    });
    const hydrated = new TaskManager(
      storage,
      new EventBus(storage.paths.home, index),
      index,
      undefined,
      { supervisor, launchConfigs },
    );
    await hydrated.hydrate();

    await assert.rejects(
      () => hydrated.restartTask(task.id),
      /launch env is missing/,
    );

    assert.deepEqual(runtimeTerminateSignals, []);
    assert.equal(spawnCalls.length, 0);
    assert.equal(hydrated.getTask(task.id).status, "orphaned");
  });

  it("continues to restart env-less records", async () => {
    const child = fakeChild();
    const { supervisor, spawnCalls } = fakeSupervisor({
      child,
      onTerminate(signal) {
        if (signal === "SIGTERM") child.emitClose(0, signal);
      },
    });
    const { manager, storage } = await createManager(supervisor);
    const task = await startFakeTask(manager, storage);
    await manager.cancelTask(task.id);

    const restarted = await manager.restartTask(task.id);

    assert.equal(spawnCalls.length, 2);
    assert.equal(spawnCalls[1]?.options.env, undefined);
    assert.equal(restarted.envInfo, undefined);
  });

  it("deletes launch config when removing a task", async () => {
    const child = fakeChild();
    const { supervisor } = fakeSupervisor({
      child,
      onTerminate(signal) {
        if (signal === "SIGTERM") child.emitClose(0, signal);
      },
    });
    const { manager, storage, launchConfigs } = await createManager(supervisor);
    const task = await startFakeTask(manager, storage, {
      API_TOKEN: "secret",
    });
    await manager.cancelTask(task.id);

    await manager.removeTask(task.id);

    assert.equal(await launchConfigs.read(task.id), undefined);
  });

  it("hydrates envInfo without raw env values", async () => {
    const env = { API_TOKEN: "secret", PORT: "4321" };
    const runtime = runtimeMetadata({ childPid: 4321, processGroupId: 4321 });
    const { supervisor } = fakeSupervisor({ runtime });
    const { manager, storage, index, launchConfigs } =
      await createManager(supervisor);
    const task = await startFakeTask(manager, storage, env);

    const hydrated = new TaskManager(
      storage,
      new EventBus(storage.paths.home, index),
      index,
      undefined,
      { supervisor: fakeSupervisor({ runtime }).supervisor, launchConfigs },
    );
    await hydrated.hydrate();

    const record = hydrated.getTask(task.id);
    const persisted = await readJsonFile<Record<string, unknown>>(
      join(storage.paths.home, "tasks", task.id, "task.json"),
    );
    assert.equal(record.status, "orphaned");
    assert.deepEqual(record.envInfo, {
      keys: ["API_TOKEN", "PORT"],
      persisted: true,
      redacted: true,
    });
    assert.equal("env" in record, false);
    assert.equal("env" in persisted, false);
  });

  it("preserves env when restarting an orphaned record after cleanup", async () => {
    const env = { API_TOKEN: "secret", PORT: "4321" };
    const runtime = runtimeMetadata({ childPid: 1234, processGroupId: 1234 });
    const replacementRuntime = runtimeMetadata({
      childPid: 9876,
      processGroupId: 9876,
      spawnedAt: "2026-01-02T03:05:05.000Z",
    });
    const { supervisor: firstSupervisor } = fakeSupervisor({ runtime });
    const { manager, storage, index, launchConfigs } =
      await createManager(firstSupervisor);
    const task = await startFakeTask(manager, storage, env);
    const { supervisor, runtimeTerminateSignals, spawnCalls } = fakeSupervisor({
      runtime: replacementRuntime,
      isRuntimeTargetAlive: () => false,
    });
    const hydrated = new TaskManager(
      storage,
      new EventBus(storage.paths.home, index),
      index,
      undefined,
      { supervisor, launchConfigs },
    );
    await hydrated.hydrate();

    const restarted = await hydrated.restartTask(task.id);

    assert.deepEqual(runtimeTerminateSignals, ["SIGTERM"]);
    assert.deepEqual(spawnCalls[0]?.options.env, env);
    assert.equal(restarted.restartedFromTaskId, task.id);
    assert.deepEqual(restarted.envInfo, {
      keys: ["API_TOKEN", "PORT"],
      persisted: true,
      redacted: true,
    });
  });
});
