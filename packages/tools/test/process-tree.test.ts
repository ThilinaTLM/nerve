import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import { forceKillProcessTree } from "../src/execution/common/process-tree.js";

function fakeProcess(pid: number): {
  process: ChildProcess;
  killSignals: NodeJS.Signals[];
} {
  const emitter = new EventEmitter() as ChildProcess;
  const killSignals: NodeJS.Signals[] = [];
  Object.defineProperty(emitter, "pid", { value: pid });
  emitter.kill = (signal = "SIGTERM") => {
    killSignals.push(signal);
    return true;
  };
  return { process: emitter, killSignals };
}

describe("process tree termination", () => {
  it("waits for Windows taskkill to finish", async () => {
    const child = fakeProcess(1234);
    const helper = fakeProcess(5678);
    let completed = false;
    const spawnCommand = ((
      command: string,
      args: readonly string[],
      options: Record<string, unknown>,
    ) => {
      assert.equal(command, "taskkill");
      assert.deepEqual(args, ["/F", "/T", "/PID", "1234"]);
      assert.equal(options.stdio, "ignore");
      assert.equal(options.windowsHide, true);
      return helper.process;
    }) as typeof spawn;

    const termination = forceKillProcessTree(child.process, {
      platform: "win32",
      spawnCommand,
    }).then(() => {
      completed = true;
    });
    await Promise.resolve();
    assert.equal(completed, false);

    helper.process.emit("close", 0, null);
    await termination;
    assert.equal(completed, true);
    assert.deepEqual(child.killSignals, []);
  });

  it("falls back to the direct child and reports taskkill failures", async () => {
    const child = fakeProcess(1234);
    const helper = fakeProcess(5678);
    const spawnCommand = (() => helper.process) as typeof spawn;

    const termination = forceKillProcessTree(child.process, {
      platform: "win32",
      spawnCommand,
    });
    helper.process.emit("close", 1, null);

    await assert.rejects(termination, /taskkill exited with code 1/);
    assert.deepEqual(child.killSignals, ["SIGKILL"]);
  });

  it("bounds a Windows taskkill helper that never exits", async () => {
    const child = fakeProcess(1234);
    const helper = fakeProcess(5678);
    const spawnCommand = (() => helper.process) as typeof spawn;

    await assert.rejects(
      forceKillProcessTree(child.process, {
        platform: "win32",
        spawnCommand,
        helperTimeoutMs: 1,
      }),
      /taskkill timed out after 1ms/,
    );
    assert.deepEqual(helper.killSignals, ["SIGKILL"]);
    assert.deepEqual(child.killSignals, ["SIGKILL"]);
  });
});
