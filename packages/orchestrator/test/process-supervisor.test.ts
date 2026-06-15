import assert from "node:assert/strict";
import type { ChildProcess, SpawnOptions, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import { terminateProcess } from "../src/domains/processes/process-supervisor.js";

interface FakeChild extends ChildProcess {
  killSignals: Array<NodeJS.Signals | number | undefined>;
}

function fakeChild(pid = 1234): FakeChild {
  return Object.assign(new EventEmitter(), {
    pid,
    killSignals: [] as Array<NodeJS.Signals | number | undefined>,
    kill(signal?: NodeJS.Signals | number) {
      this.killSignals.push(signal);
      return true;
    },
  }) as FakeChild;
}

describe("process supervisor termination", () => {
  it("uses taskkill tree termination on Windows", async () => {
    const child = fakeChild(1234);
    const helper = fakeChild(5678);
    const calls: Array<{
      command: string;
      args: readonly string[] | undefined;
      options: SpawnOptions | undefined;
    }> = [];
    const fakeSpawn = ((
      command: string,
      args?: readonly string[],
      options?: SpawnOptions,
    ) => {
      calls.push({ command, args, options });
      return helper;
    }) as typeof spawn;

    const resultPromise = terminateProcess(child, "SIGTERM", {
      platform: "win32",
      spawnCommand: fakeSpawn,
    });
    helper.emit("close", 0, null);
    const result = await resultPromise;

    assert.equal(result.method, "taskkill");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "taskkill");
    assert.deepEqual(calls[0].args, ["/F", "/T", "/PID", "1234"]);
    assert.equal(calls[0].options?.windowsHide, true);
    assert.equal(calls[0].options?.stdio, "ignore");
    assert.deepEqual(child.killSignals, []);
  });

  it("bounds the Windows taskkill helper wait", async () => {
    const child = fakeChild(1234);
    const helper = fakeChild(5678);
    const fakeSpawn = (() => helper) as typeof spawn;

    const startedAt = Date.now();
    const result = await terminateProcess(child, "SIGTERM", {
      platform: "win32",
      spawnCommand: fakeSpawn,
      helperTimeoutMs: 5,
    });

    assert.equal(result.method, "taskkill");
    assert.match(result.error ?? "", /timed out/);
    assert.deepEqual(helper.killSignals, ["SIGKILL"]);
    assert.ok(Date.now() - startedAt < 250);
  });

  it("prefers process-group signaling on non-Windows platforms", async () => {
    const child = fakeChild(1234);
    const killCalls: Array<{
      pid: number;
      signal: string | number | undefined;
    }> = [];
    const killProcess = ((pid: number, signal?: string | number) => {
      killCalls.push({ pid, signal });
      return true;
    }) as typeof process.kill;

    const result = await terminateProcess(child, "SIGTERM", {
      platform: "linux",
      killProcess,
    });

    assert.equal(result.method, "process-group");
    assert.deepEqual(killCalls, [{ pid: -1234, signal: "SIGTERM" }]);
    assert.deepEqual(child.killSignals, []);
  });

  it("falls back to direct child kill when process-group signaling fails", async () => {
    const child = fakeChild(1234);
    const killProcess = (() => {
      throw new Error("no such process group");
    }) as typeof process.kill;

    const result = await terminateProcess(child, "SIGINT", {
      platform: "linux",
      killProcess,
    });

    assert.equal(result.method, "direct-child");
    assert.deepEqual(child.killSignals, ["SIGINT"]);
  });
});
