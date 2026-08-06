import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import {
  defaultProcessRuntimeDriver,
  observeProcessLifecycle,
} from "../src/domains/tasks/process-runtime/index.js";

test("replays process exit, close, and error outcomes to late consumers", async () => {
  const closedChild = new EventEmitter() as ChildProcess;
  const lifecycle = observeProcessLifecycle(closedChild);
  closedChild.emit("exit", 0, null);
  closedChild.emit("close", 0, null);
  const expected = { kind: "closed", exitCode: 0, signal: null };
  assert.deepEqual(await lifecycle.exited, expected);
  assert.deepEqual(await lifecycle.closed, expected);

  const errorChild = new EventEmitter() as ChildProcess;
  const errored = observeProcessLifecycle(errorChild);
  const error = new Error("spawn failed");
  errorChild.emit("error", error);
  assert.deepEqual(await errored.exited, { kind: "error", error });
  assert.deepEqual(await errored.closed, { kind: "error", error });
});

test("captures an immediate command close while resolving runtime identity", async () => {
  const spawned = defaultProcessRuntimeDriver.spawn("printf done", {
    cwd: process.cwd(),
  });
  assert.equal((await spawned.exited).kind, "closed");
  assert.equal((await spawned.closed).kind, "closed");
  assert.equal((await spawned.runtime).platform, process.platform);
});

if (process.platform === "linux") {
  test("captures a verifiable Linux identity and refuses stale identity", async () => {
    const spawned = defaultProcessRuntimeDriver.spawn("sleep 30", {
      cwd: process.cwd(),
    });
    const runtime = await spawned.runtime;
    try {
      assert.equal(
        (await defaultProcessRuntimeDriver.inspect(runtime)).evidence,
        "alive_verified",
      );
      const stale = {
        ...runtime,
        identity: {
          kind: "linux" as const,
          startTimeTicks:
            runtime.identity?.kind === "linux"
              ? runtime.identity.startTimeTicks + 1
              : 1,
        },
      };
      assert.equal(
        (await defaultProcessRuntimeDriver.inspect(stale)).evidence,
        "identity_mismatch",
      );
      const refused = await defaultProcessRuntimeDriver.terminate(
        stale,
        "SIGKILL",
      );
      assert.equal(refused.attempted, false);
    } finally {
      await defaultProcessRuntimeDriver.terminate(runtime, "SIGKILL");
    }
  });
}
