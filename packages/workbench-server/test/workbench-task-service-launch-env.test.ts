import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { WorkbenchTaskService } from "../src/domains/tasks/workbench-task-service.js";
import { StreamLogRegistry } from "../src/infrastructure/events/index.js";
import { readJsonFile } from "../src/infrastructure/storage/index.js";
import {
  createManager,
  fakeChild,
  fakeSupervisor,
  runtimeMetadata,
  startFakeTask,
} from "./helpers/workbench-task-service.js";

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
      JSON.stringify(
        (await events.readStream("workspace", 1, 5_000)).events,
      ).includes("secret"),
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
    const hydrated = new WorkbenchTaskService(
      storage,
      new StreamLogRegistry(storage.paths.home),
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
