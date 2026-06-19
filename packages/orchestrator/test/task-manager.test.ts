import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  createId,
  type StartTaskRequest,
  type TaskLaunchConfig,
  type TaskRecord,
  type TaskRuntime,
} from "@nerve/shared";
import type { TaskLaunchConfigStore } from "../src/domains/tasks/task-launch-config.store.js";
import { TaskManager } from "../src/domains/tasks/task-manager.js";
import type {
  SpawnManagedTaskOptions,
  TaskSupervisor,
  TerminateTaskResult,
} from "../src/domains/tasks/task-supervisor.js";
import { EventBus } from "../src/infrastructure/events/index.js";
import { IndexStore } from "../src/infrastructure/index-store/index.js";
import {
  atomicWriteJson,
  type InitializedStorage,
  initializeStorage,
  readJsonFile,
} from "../src/infrastructure/storage/index.js";

interface FakeChild extends ChildProcess {
  stdout: EventEmitter;
  stderr: EventEmitter;
  killSignals: Array<NodeJS.Signals | number | undefined>;
  emitClose(exitCode: number | null, signal: NodeJS.Signals | null): void;
}

const roots: string[] = [];
const indexes: IndexStore[] = [];

after(async () => {
  for (const index of indexes) index.close();
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("task manager cancel lifecycle", () => {
  it("returns after timeout when the child never closes", async () => {
    const child = fakeChild();
    const { supervisor, terminateSignals } = fakeSupervisor({ child });
    const { manager, storage } = await createManager(supervisor);
    const task = await startFakeTask(manager, storage);

    const startedAt = Date.now();
    const stopped = await manager.cancelTask(task.id, { timeoutMs: 20 });

    assert.ok(Date.now() - startedAt < 500);
    assert.equal(stopped.status, "cancelled");
    assert.equal(stopped.exitCode, null);
    assert.equal(stopped.signal, "SIGKILL");
    assert.deepEqual(terminateSignals, ["SIGTERM", "SIGKILL"]);
  });

  it("does not let a late close overwrite a force-finalized cancelled record", async () => {
    const child = fakeChild();
    const { supervisor } = fakeSupervisor({ child });
    const { manager, storage } = await createManager(supervisor);
    const task = await startFakeTask(manager, storage);

    const stopped = await manager.cancelTask(task.id, { timeoutMs: 20 });
    child.emitClose(1, null);
    await delay(0);

    const stored = manager.getTask(stopped.id);
    assert.equal(stored.status, "cancelled");
    assert.equal(stored.exitCode, null);
    assert.equal(stored.signal, "SIGKILL");
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

  it("is idempotent for terminal records", async () => {
    const child = fakeChild();
    const { supervisor, terminateSignals } = fakeSupervisor({ child });
    const { manager, storage } = await createManager(supervisor);
    const task = await startFakeTask(manager, storage);

    const stopped = await manager.cancelTask(task.id, { timeoutMs: 20 });
    const again = await manager.cancelTask(task.id, { timeoutMs: 20 });

    assert.equal(again.id, stopped.id);
    assert.equal(again.status, "cancelled");
    assert.deepEqual(terminateSignals, ["SIGTERM", "SIGKILL"]);
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

  it("hydrates active persisted records as orphaned and preserves runtime", async () => {
    const runtime = runtimeMetadata({ childPid: 4321, processGroupId: 4321 });
    const { supervisor } = fakeSupervisor({ child: fakeChild(4321), runtime });
    const { manager, storage, index, launchConfigs } =
      await createManager(supervisor);
    const task = await startFakeTask(manager, storage);

    const hydrated = new TaskManager(
      storage,
      new EventBus(storage.paths.home, index),
      index,
      undefined,
      {
        supervisor: fakeSupervisor({ runtime }).supervisor,
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

  it("matches readyOnUrl across stdout chunks", async () => {
    const child = fakeChild();
    const { supervisor } = fakeSupervisor({ child });
    const { manager, storage, events } = await createManager(supervisor);
    const startedEvent = waitForTaskEvent(events, "task.started");

    const start = startFakeTask(manager, storage, undefined, {
      readyOnUrl: true,
      readyTimeoutMs: 1000,
    });
    const started = await startedEvent;
    const readyEvent = waitForTaskEvent(events, "task.ready", started.id);
    child.stdout.emit("data", "Listening at http://localhost:");
    child.stdout.emit("data", "5173\n");

    await start;
    await readyEvent;
    const task = manager.getTask(started.id);

    assert.equal(task.readiness.outcome, "ready");
    assert.equal(task.readiness.matched, "http://localhost:5173");
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

  it("uses final flush to satisfy readiness before exit", async () => {
    const child = fakeChild();
    const { supervisor } = fakeSupervisor({ child });
    const { manager, storage, events } = await createManager(supervisor);
    const startedEvent = waitForTaskEvent(events, "task.started");

    const start = startFakeTask(manager, storage, undefined, {
      readyPattern: "final ready",
      readyTimeoutMs: 1000,
    });
    const started = await startedEvent;
    const exitedEvent = waitForTaskEvent(events, "task.completed", started.id);
    child.stdout.emit("data", "final ready");
    child.emitClose(0, null);

    await start;
    await exitedEvent;
    const stored = manager.getTask(started.id);

    assert.equal(stored.status, "completed");
    assert.equal(stored.readiness.outcome, "ready");
    assert.equal(stored.readiness.matched, "final ready");
  });

  it("flushes buffered stderr before marking task error", async () => {
    const child = fakeChild();
    const { supervisor } = fakeSupervisor({ child });
    const { manager, storage, events } = await createManager(supervisor);
    const task = await startFakeTask(manager, storage);
    const errorEvent = waitForTaskEvent(events, "task.failed", task.id);

    child.stderr.emit("data", "fatal failure");
    child.emit("error", new Error("boom"));
    await errorEvent;

    const logs = await manager.queryLogs(task.id, { mode: "errors" });
    assert.deepEqual(
      logs.events.map((event) => event.line),
      ["fatal failure"],
    );
  });

  it("flushes buffered output during force-finalized stop", async () => {
    const child = fakeChild();
    const { supervisor } = fakeSupervisor({ child });
    const { manager, storage } = await createManager(supervisor);
    const task = await startFakeTask(manager, storage);

    child.stdout.emit("data", "stopping output");
    const stopped = await manager.cancelTask(task.id, { timeoutMs: 20 });

    const logs = await manager.queryLogs(task.id);
    assert.equal(stopped.status, "cancelled");
    assert.deepEqual(
      logs.events.map((event) => event.line),
      ["stopping output"],
    );
  });
});

describe("task manager runtime timeout", () => {
  it("uses timed_out status when runtime timeout termination closes the child", async () => {
    const child = fakeChild();
    const { supervisor, terminateSignals } = fakeSupervisor({
      child,
      onTerminate(signal) {
        if (signal === "SIGTERM") child.emitClose(null, signal);
      },
    });
    const { manager, storage, events } = await createManager(supervisor);
    const timedOutEvent = waitForTaskEvent(events, "task.timed_out");

    const task = await startFakeTask(manager, storage, undefined, {
      timeoutMs: 20,
    });
    const timedOut = await timedOutEvent;

    assert.equal(timedOut.id, task.id);
    assert.equal(timedOut.status, "timed_out");
    assert.equal(timedOut.signal, "SIGTERM");
    assert.match(timedOut.error ?? "", /maximum runtime/);
    assert.deepEqual(terminateSignals, ["SIGTERM"]);
  });
});

describe("task manager orphan cleanup", () => {
  it("cleans up an orphaned record with runtime metadata", async () => {
    const runtime = runtimeMetadata();
    const { supervisor, runtimeTerminateSignals } = fakeSupervisor({
      runtime,
      isRuntimeTargetAlive: () => false,
    });
    const { manager, storage, events } = await createManager(supervisor);
    const record = await seedTaskRecord(storage, { runtime });
    await manager.hydrate();

    const stopped = await manager.cancelTask(record.id);

    assert.equal(stopped.status, "cancelled");
    assert.equal(stopped.exitCode, null);
    assert.equal(stopped.signal, "SIGTERM");
    assert.deepEqual(runtimeTerminateSignals, ["SIGTERM"]);
    assert.ok(
      events.replaySince(0).some((event) => event.type === "task.cancelled"),
    );
  });

  it("escalates orphan cleanup to SIGKILL after timeout on non-Windows", async () => {
    const runtime = runtimeMetadata();
    const { supervisor, runtimeTerminateSignals } = fakeSupervisor({
      runtime,
      isRuntimeTargetAlive: () => true,
    });
    const { manager, storage } = await createManager(supervisor);
    const record = await seedTaskRecord(storage, { runtime });
    await manager.hydrate();

    const stopped = await manager.cancelTask(record.id, { timeoutMs: 20 });

    assert.equal(stopped.status, "cancelled");
    assert.equal(stopped.signal, "SIGKILL");
    assert.deepEqual(runtimeTerminateSignals, ["SIGTERM", "SIGKILL"]);
  });

  it("does not escalate orphan cleanup when the target disappears", async () => {
    const runtime = runtimeMetadata();
    const { supervisor, runtimeTerminateSignals } = fakeSupervisor({
      runtime,
      isRuntimeTargetAlive: () => false,
    });
    const { manager, storage } = await createManager(supervisor);
    const record = await seedTaskRecord(storage, { runtime });
    await manager.hydrate();

    const stopped = await manager.cancelTask(record.id, { timeoutMs: 100 });

    assert.equal(stopped.status, "cancelled");
    assert.equal(stopped.signal, "SIGTERM");
    assert.deepEqual(runtimeTerminateSignals, ["SIGTERM"]);
  });

  it("keeps old orphaned records without runtime metadata and surfaces an error", async () => {
    const { supervisor } = fakeSupervisor({});
    const { manager, storage } = await createManager(supervisor);
    const record = await seedTaskRecord(storage, { runtime: undefined });
    await manager.hydrate();

    await assert.rejects(
      () => manager.cancelTask(record.id),
      /no PID metadata was captured/,
    );

    const stored = manager.getTask(record.id);
    assert.equal(stored.status, "orphaned");
    assert.match(stored.error ?? "", /no PID metadata was captured/);
  });

  it("keeps platform-mismatched orphaned records and surfaces an error", async () => {
    const mismatchedPlatform = process.platform === "win32" ? "linux" : "win32";
    const runtime = runtimeMetadata({
      platform: mismatchedPlatform,
      detached: mismatchedPlatform !== "win32",
      processGroupId: mismatchedPlatform === "win32" ? undefined : 1234,
    });
    const { supervisor, runtimeTerminateSignals } = fakeSupervisor({ runtime });
    const { manager, storage } = await createManager(supervisor);
    const record = await seedTaskRecord(storage, { runtime });
    await manager.hydrate();

    await assert.rejects(
      () => manager.cancelTask(record.id),
      new RegExp(`spawned on ${mismatchedPlatform} from ${process.platform}`),
    );

    const stored = manager.getTask(record.id);
    assert.equal(stored.status, "orphaned");
    assert.match(stored.error ?? "", /Cannot clean up task spawned/);
    assert.deepEqual(runtimeTerminateSignals, []);
  });

  it("cleans an orphaned task before restarting", async () => {
    const order: string[] = [];
    const runtime = runtimeMetadata({ childPid: 1234, processGroupId: 1234 });
    const replacementRuntime = runtimeMetadata({
      childPid: 9876,
      processGroupId: 9876,
      spawnedAt: "2026-01-02T03:05:05.000Z",
    });
    const { supervisor, runtimeTerminateSignals, spawnCommands } =
      fakeSupervisor({
        runtime: replacementRuntime,
        isRuntimeTargetAlive: () => false,
        onTerminateRuntime(_runtime, signal) {
          order.push(`terminateRuntime:${signal}`);
        },
        onSpawn() {
          order.push("spawn");
        },
      });
    const { manager, storage } = await createManager(supervisor);
    const record = await seedTaskRecord(storage, { runtime });
    await manager.hydrate();

    const restarted = await manager.restartTask(record.id);

    assert.deepEqual(order, ["terminateRuntime:SIGTERM", "spawn"]);
    assert.deepEqual(runtimeTerminateSignals, ["SIGTERM"]);
    assert.equal(manager.getTask(record.id).status, "cancelled");
    assert.equal(restarted.restartedFromTaskId, record.id);
    assert.equal(spawnCommands.length, 1);
  });

  it("does not start a duplicate task when orphan cleanup fails", async () => {
    const runtime = runtimeMetadata();
    const { supervisor, spawnCommands } = fakeSupervisor({
      runtime,
      onTerminateRuntime() {
        return { attempted: false, method: "none", error: "cleanup failed" };
      },
    });
    const { manager, storage } = await createManager(supervisor);
    const record = await seedTaskRecord(storage, { runtime });
    await manager.hydrate();

    await assert.rejects(
      () => manager.restartTask(record.id),
      /cleanup failed/,
    );

    assert.equal(manager.getTask(record.id).status, "orphaned");
    assert.equal(spawnCommands.length, 0);
  });
});

class MemoryTaskLaunchConfigStore implements TaskLaunchConfigStore {
  readonly configs = new Map<string, TaskLaunchConfig>();

  async write(taskId: string, config: TaskLaunchConfig): Promise<void> {
    this.configs.set(taskId, structuredClone(config));
  }

  async read(taskId: string): Promise<TaskLaunchConfig | undefined> {
    const config = this.configs.get(taskId);
    return config ? structuredClone(config) : undefined;
  }

  async remove(taskId: string): Promise<void> {
    this.configs.delete(taskId);
  }
}

async function tempHome(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function createManager(
  supervisor: TaskSupervisor,
  launchConfigs = new MemoryTaskLaunchConfigStore(),
): Promise<{
  manager: TaskManager;
  storage: InitializedStorage;
  events: EventBus;
  index: IndexStore;
  launchConfigs: MemoryTaskLaunchConfigStore;
}> {
  const storage = await initializeStorage(await tempHome("nerve-tasks-"));
  const index = new IndexStore(storage.paths.sqlitePath);
  index.initialize();
  indexes.push(index);
  const events = new EventBus(storage.paths.home, index);
  return {
    manager: new TaskManager(storage, events, index, undefined, {
      supervisor,
      launchConfigs,
    }),
    storage,
    events,
    index,
    launchConfigs,
  };
}

function fakeChild(pid = 1234): FakeChild {
  const child = new EventEmitter() as FakeChild;
  const killSignals: Array<NodeJS.Signals | number | undefined> = [];
  return Object.assign(child, {
    pid,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    killSignals,
    kill(signal?: NodeJS.Signals | number) {
      killSignals.push(signal);
      return true;
    },
    emitClose(exitCode: number | null, signal: NodeJS.Signals | null) {
      child.emit("close", exitCode, signal);
    },
  });
}

function runtimeMetadata(overrides: Partial<TaskRuntime> = {}): TaskRuntime {
  return {
    platform: process.platform,
    childPid: 1234,
    processGroupId: process.platform === "win32" ? undefined : 1234,
    detached: process.platform !== "win32",
    shell: true,
    spawnedAt: "2026-01-02T03:04:05.000Z",
    ...overrides,
  };
}

type FakeSupervisorOptions = {
  child?: FakeChild;
  runtime?: TaskRuntime;
  onSpawn?: (command: string, options: SpawnManagedTaskOptions) => void;
  onTerminate?: (signal: NodeJS.Signals) => void | Promise<void>;
  onTerminateRuntime?: (
    runtime: TaskRuntime,
    signal: NodeJS.Signals,
  ) =>
    | TerminateTaskResult
    | undefined
    | Promise<TerminateTaskResult | undefined>;
  isRuntimeTargetAlive?: (runtime: TaskRuntime) => boolean | Promise<boolean>;
};

function fakeSupervisor(options: FakeSupervisorOptions): {
  supervisor: TaskSupervisor;
  terminateSignals: NodeJS.Signals[];
  runtimeTerminateSignals: NodeJS.Signals[];
  spawnCommands: string[];
  spawnCalls: Array<{ command: string; options: SpawnManagedTaskOptions }>;
} {
  const child = options.child ?? fakeChild();
  const runtime = options.runtime ?? runtimeMetadata({ childPid: child.pid });
  const terminateSignals: NodeJS.Signals[] = [];
  const runtimeTerminateSignals: NodeJS.Signals[] = [];
  const spawnCommands: string[] = [];
  const spawnCalls: Array<{
    command: string;
    options: SpawnManagedTaskOptions;
  }> = [];
  return {
    terminateSignals,
    runtimeTerminateSignals,
    spawnCommands,
    spawnCalls,
    supervisor: {
      spawn(command, spawnOptions) {
        spawnCommands.push(command);
        spawnCalls.push({ command, options: spawnOptions });
        options.onSpawn?.(command, spawnOptions);
        return { child, runtime };
      },
      async terminate(terminatedChild, signal) {
        assert.equal(terminatedChild, child);
        terminateSignals.push(signal);
        await options.onTerminate?.(signal);
        return { attempted: true, method: "direct-child" };
      },
      async terminateRuntime(targetRuntime, signal) {
        runtimeTerminateSignals.push(signal);
        const result = await options.onTerminateRuntime?.(
          targetRuntime,
          signal,
        );
        return result ?? { attempted: true, method: "process-group" };
      },
      async isRuntimeTargetAlive(targetRuntime) {
        return options.isRuntimeTargetAlive?.(targetRuntime) ?? false;
      },
    },
  };
}

function waitForTaskEvent(
  events: EventBus,
  type: string,
  taskId?: string,
): Promise<TaskRecord> {
  return new Promise((resolve) => {
    const unsubscribe = events.subscribe((event) => {
      if (event.type !== type) return;
      const data = event.data as { task?: TaskRecord };
      if (!data.task) return;
      if (taskId && data.task.id !== taskId) return;
      unsubscribe();
      resolve(data.task);
    });
  });
}

async function startFakeTask(
  manager: TaskManager,
  storage: InitializedStorage,
  env?: Record<string, string>,
  patch: Partial<Omit<StartTaskRequest, "cwd" | "command" | "env">> = {},
) {
  return manager.startTask({
    cwd: storage.paths.home,
    command: "fake long-running command",
    env,
    readyTimeoutMs: 0,
    ...patch,
  });
}

async function seedTaskRecord(
  storage: InitializedStorage,
  patch: Partial<TaskRecord>,
): Promise<TaskRecord> {
  const id = patch.id ?? createId("task");
  const dir = join(storage.paths.home, "tasks", id);
  await mkdir(dir, { recursive: true });
  const now = new Date().toISOString();
  const record: TaskRecord = {
    id,
    cwd: storage.paths.home,
    command: "fake orphaned command",
    status: "orphaned",
    readiness: { outcome: "pending" },
    stdoutPath: join(dir, "stdout.log"),
    stderrPath: join(dir, "stderr.log"),
    logsPath: join(dir, "logs.jsonl"),
    startedAt: now,
    updatedAt: now,
    ...patch,
  };
  await atomicWriteJson(join(dir, "task.json"), record, 0o600);
  return record;
}
