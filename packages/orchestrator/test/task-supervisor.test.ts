import assert from "node:assert/strict";
import type { ChildProcess, SpawnOptions, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import type { TaskRuntime } from "@nervekit/shared";
import {
  isTaskRuntimeTargetAlive,
  runtimeForChild,
  spawnManagedTask,
  terminateTask,
  terminateTaskRuntime,
} from "../src/domains/tasks/task-supervisor.js";

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

const node = JSON.stringify(process.execPath);

function printEnvCommand(keys: string[]): string {
  const script = `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map((key) => [key, process.env[key]]))))`;
  return `${node} -e ${JSON.stringify(script)}`;
}

async function collectSpawnedStdout(
  command: string,
  env?: Record<string, string>,
): Promise<string> {
  const { child } = spawnManagedTask(command, { cwd: process.cwd(), env });
  const chunks: Buffer[] = [];
  child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
  const close = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  assert.equal(close.code, 0);
  assert.equal(close.signal, null);
  return Buffer.concat(chunks).toString("utf8");
}

const spawnedAt = "2026-01-02T03:04:05.000Z";

function runtime(overrides: Partial<TaskRuntime> = {}): TaskRuntime {
  return {
    platform: "linux",
    childPid: 1234,
    processGroupId: 1234,
    detached: true,
    shell: true,
    spawnedAt,
    ...overrides,
  };
}

describe("task supervisor spawn metadata", () => {
  it("spawns with non-interactive pager-safe environment defaults", async () => {
    const output = await collectSpawnedStdout(
      printEnvCommand([
        "PAGER",
        "GIT_PAGER",
        "GIT_TERMINAL_PROMPT",
        "TERM",
        "CI",
      ]),
    );
    const env = JSON.parse(output) as Record<string, string>;

    assert.equal(env.PAGER, "cat");
    assert.equal(env.GIT_PAGER, "cat");
    assert.equal(env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(env.TERM, "dumb");
    assert.equal(env.CI, process.env.CI ?? "1");
  });

  it("allows explicit managed task env to override non-interactive defaults", async () => {
    const output = await collectSpawnedStdout(
      printEnvCommand(["PAGER", "GIT_TERMINAL_PROMPT", "CUSTOM_VALUE"]),
      {
        PAGER: "less",
        GIT_TERMINAL_PROMPT: "1",
        CUSTOM_VALUE: "ok",
      },
    );
    const env = JSON.parse(output) as Record<string, string>;

    assert.equal(env.PAGER, "less");
    assert.equal(env.GIT_TERMINAL_PROMPT, "1");
    assert.equal(env.CUSTOM_VALUE, "ok");
  });

  it("builds non-Windows runtime metadata with process group", () => {
    const metadata = runtimeForChild(
      { pid: 1234 },
      "linux",
      new Date(spawnedAt),
    );

    assert.deepEqual(metadata, {
      platform: "linux",
      childPid: 1234,
      processGroupId: 1234,
      detached: true,
      shell: true,
      spawnedAt,
    });
  });

  it("builds Windows runtime metadata without process group", () => {
    const metadata = runtimeForChild(
      { pid: 1234 },
      "win32",
      new Date(spawnedAt),
    );

    assert.deepEqual(metadata, {
      platform: "win32",
      childPid: 1234,
      processGroupId: undefined,
      detached: false,
      shell: true,
      spawnedAt,
    });
  });
});

describe("task supervisor termination", () => {
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

    const resultPromise = terminateTask(child, "SIGTERM", {
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
    const result = await terminateTask(child, "SIGTERM", {
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
    const killTask = ((pid: number, signal?: string | number) => {
      killCalls.push({ pid, signal });
      return true;
    }) as typeof process.kill;

    const result = await terminateTask(child, "SIGTERM", {
      platform: "linux",
      killTask,
    });

    assert.equal(result.method, "process-group");
    assert.deepEqual(killCalls, [{ pid: -1234, signal: "SIGTERM" }]);
    assert.deepEqual(child.killSignals, []);
  });

  it("falls back to direct child kill when process-group signaling fails", async () => {
    const child = fakeChild(1234);
    const killTask = (() => {
      throw new Error("no such process group");
    }) as typeof process.kill;

    const result = await terminateTask(child, "SIGINT", {
      platform: "linux",
      killTask,
    });

    assert.equal(result.method, "direct-child");
    assert.deepEqual(child.killSignals, ["SIGINT"]);
  });
});

describe("task supervisor runtime cleanup", () => {
  it("uses taskkill for Windows runtime cleanup", async () => {
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

    const resultPromise = terminateTaskRuntime(
      runtime({
        platform: "win32",
        processGroupId: undefined,
        detached: false,
      }),
      "SIGKILL",
      { platform: "win32", spawnCommand: fakeSpawn },
    );
    helper.emit("close", 0, null);
    const result = await resultPromise;

    assert.equal(result.method, "taskkill");
    assert.equal(calls[0].command, "taskkill");
    assert.deepEqual(calls[0].args, ["/F", "/T", "/PID", "1234"]);
  });

  it("prefers process-group signaling for non-Windows runtime cleanup", async () => {
    const killCalls: Array<{
      pid: number;
      signal: string | number | undefined;
    }> = [];
    const killTask = ((pid: number, signal?: string | number) => {
      killCalls.push({ pid, signal });
      return true;
    }) as typeof process.kill;

    const result = await terminateTaskRuntime(
      runtime({ processGroupId: 1234, childPid: 5678 }),
      "SIGTERM",
      { platform: "linux", killTask },
    );

    assert.equal(result.method, "process-group");
    assert.deepEqual(killCalls, [{ pid: -1234, signal: "SIGTERM" }]);
  });

  it("falls back to child PID when runtime has no process group", async () => {
    const killCalls: Array<{
      pid: number;
      signal: string | number | undefined;
    }> = [];
    const killTask = ((pid: number, signal?: string | number) => {
      killCalls.push({ pid, signal });
      return true;
    }) as typeof process.kill;

    const result = await terminateTaskRuntime(
      runtime({ processGroupId: undefined, childPid: 5678 }),
      "SIGINT",
      { platform: "linux", killTask },
    );

    assert.equal(result.method, "direct-child");
    assert.deepEqual(killCalls, [{ pid: 5678, signal: "SIGINT" }]);
  });

  it("does not signal on platform mismatch", async () => {
    const killCalls: Array<number> = [];
    const killTask = ((pid: number) => {
      killCalls.push(pid);
      return true;
    }) as typeof process.kill;

    const result = await terminateTaskRuntime(
      runtime({
        platform: "win32",
        detached: false,
        processGroupId: undefined,
      }),
      "SIGKILL",
      { platform: "linux", killTask },
    );

    assert.equal(result.attempted, false);
    assert.equal(result.method, "none");
    assert.match(result.error ?? "", /spawned on win32 from linux/);
    assert.deepEqual(killCalls, []);
  });

  it("returns an error when runtime target metadata is missing", async () => {
    const result = await terminateTaskRuntime(
      runtime({ childPid: undefined, processGroupId: undefined }),
      "SIGTERM",
      { platform: "linux" },
    );

    assert.equal(result.attempted, false);
    assert.equal(result.method, "none");
    assert.match(result.error ?? "", /no process-group or child PID metadata/);
  });

  it("liveness checks treat ESRCH as not alive and EPERM as alive", async () => {
    const esrchKill = (() => {
      throw Object.assign(new Error("missing"), { code: "ESRCH" });
    }) as typeof process.kill;
    const epermKill = (() => {
      throw Object.assign(new Error("denied"), { code: "EPERM" });
    }) as typeof process.kill;

    assert.equal(
      await isTaskRuntimeTargetAlive(runtime(), {
        platform: "linux",
        killTask: esrchKill,
      }),
      false,
    );
    assert.equal(
      await isTaskRuntimeTargetAlive(runtime(), {
        platform: "linux",
        killTask: epermKill,
      }),
      true,
    );
  });
});
