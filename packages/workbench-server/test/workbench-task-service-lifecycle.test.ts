import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createManager,
  fakeChild,
  fakeSupervisor,
  startFakeTask,
} from "./helpers/workbench-task-service.js";

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
