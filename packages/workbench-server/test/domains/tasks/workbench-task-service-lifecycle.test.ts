import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createManager,
  fakeChild,
  fakeSupervisor,
  runtimeMetadata,
  seedTaskRecord,
  startFakeTask,
  waitForTaskEvent,
} from "../../helpers/workbench-task-service.js";

describe("task manager cancel lifecycle", () => {
  it("uses process exit evidence when inherited stdio remains open", async () => {
    const child = fakeChild();
    const { supervisor, terminateSignals } = fakeSupervisor({
      child,
      onTerminate(signal) {
        if (signal === "SIGTERM") child.emitExit(0, "SIGTERM");
      },
    });
    const { manager, storage } = await createManager(supervisor);
    const task = await startFakeTask(manager, storage);

    const stopped = await manager.cancelTask(task.id, { timeoutMs: 1000 });

    assert.equal(stopped.status, "cancelled");
    assert.equal(stopped.exitCode, 0);
    assert.equal(stopped.signal, "SIGTERM");
    assert.equal(manager.managed.get(task.id)?.finalized, false);
    assert.deepEqual(terminateSignals, ["SIGTERM"]);
  });
});

describe("task publication preserves authoritative commands", () => {
  const command = "echo " + "x".repeat(70_000);

  for (const alive of [false, true]) {
    it(`hydrates oversized commands and publishes ${alive ? "recovered" : "interrupted"} on the first attempt`, async () => {
      const { supervisor } = fakeSupervisor({
        isRuntimeTargetAlive: () => alive,
      });
      const { manager, storage, events } = await createManager(supervisor);
      const seeded = await seedTaskRecord(storage, {
        command,
        status: "running",
        runtime: runtimeMetadata(),
      });
      const type = alive ? "task.recovered" : "task.interrupted";
      const published = waitForTaskEvent(events, type, seeded.id);

      await manager.hydrate();

      assert.equal((await published).command, command);
      assert.equal(
        manager.getTask(seeded.id).status,
        alive ? "recovered" : "interrupted",
      );
      const stored = (await manager.taskRepository.hydrate()).find(
        (record) => record.id === seeded.id,
      );
      assert.equal(stored?.command, command);
      assert.equal(stored?.status, alive ? "recovered" : "interrupted");
    });
  }

  it("launches, publishes, and completes without shortening the executable command", async () => {
    const child = fakeChild();
    const { supervisor, spawnCommands } = fakeSupervisor({ child });
    const { manager, storage, events } = await createManager(supervisor);
    const created = waitForTaskEvent(events, "task.created");
    const started = waitForTaskEvent(events, "task.started");
    const task = await manager.startTask({
      cwd: storage.paths.home,
      command,
      readyTimeoutMs: 0,
    });
    assert.deepEqual(spawnCommands, [command]);
    assert.equal((await created).command, command);
    assert.equal((await started).command, command);

    const completed = waitForTaskEvent(events, "task.completed", task.id);
    child.emitClose(0, null);
    assert.equal((await completed).command, command);
    assert.equal(
      (await manager.taskRepository.hydrate()).find(
        (record) => record.id === task.id,
      )?.command,
      command,
    );
  });
});
