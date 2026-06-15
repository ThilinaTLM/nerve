import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  createId,
  type ProcessLaunchConfig,
  type ProcessRecord,
  type ProcessRuntime,
  type StartProcessRequest,
} from "@nerve/shared";
import type { ProcessLaunchConfigStore } from "../src/domains/processes/process-launch-config.store.js";
import { ProcessManager } from "../src/domains/processes/process-manager.js";
import type {
  ProcessSupervisor,
  SpawnManagedProcessOptions,
  TerminateProcessResult,
} from "../src/domains/processes/process-supervisor.js";
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

describe("process manager stop lifecycle", () => {
  it("returns after timeout when the child never closes", async () => {
    const child = fakeChild();
    const { supervisor, terminateSignals } = fakeSupervisor({ child });
    const { manager, storage } = await createManager(supervisor);
    const process = await startFakeProcess(manager, storage);

    const startedAt = Date.now();
    const stopped = await manager.stopProcess(process.id, { timeoutMs: 20 });

    assert.ok(Date.now() - startedAt < 500);
    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.exitCode, null);
    assert.equal(stopped.signal, "SIGKILL");
    assert.deepEqual(terminateSignals, ["SIGTERM", "SIGKILL"]);
  });

  it("does not let a late close overwrite a force-finalized stopped record", async () => {
    const child = fakeChild();
    const { supervisor } = fakeSupervisor({ child });
    const { manager, storage } = await createManager(supervisor);
    const process = await startFakeProcess(manager, storage);

    const stopped = await manager.stopProcess(process.id, { timeoutMs: 20 });
    child.emitClose(1, null);
    await delay(0);

    const stored = manager.getProcess(stopped.id);
    assert.equal(stored.status, "stopped");
    assert.equal(stored.exitCode, null);
    assert.equal(stored.signal, "SIGKILL");
  });

  it("returns a stopped record when the child closes normally", async () => {
    const child = fakeChild();
    const { supervisor, terminateSignals } = fakeSupervisor({
      child,
      onTerminate(signal) {
        if (signal === "SIGTERM") child.emitClose(0, "SIGTERM");
      },
    });
    const { manager, storage } = await createManager(supervisor);
    const process = await startFakeProcess(manager, storage);

    const stopped = await manager.stopProcess(process.id, { timeoutMs: 1000 });

    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.exitCode, 0);
    assert.equal(stopped.signal, "SIGTERM");
    assert.deepEqual(terminateSignals, ["SIGTERM"]);
  });

  it("is idempotent for terminal records", async () => {
    const child = fakeChild();
    const { supervisor, terminateSignals } = fakeSupervisor({ child });
    const { manager, storage } = await createManager(supervisor);
    const process = await startFakeProcess(manager, storage);

    const stopped = await manager.stopProcess(process.id, { timeoutMs: 20 });
    const again = await manager.stopProcess(process.id, { timeoutMs: 20 });

    assert.equal(again.id, stopped.id);
    assert.equal(again.status, "stopped");
    assert.deepEqual(terminateSignals, ["SIGTERM", "SIGKILL"]);
  });
});

describe("process manager runtime metadata", () => {
  it("persists runtime metadata when starting a process", async () => {
    const runtime = runtimeMetadata({ childPid: 4321, processGroupId: 4321 });
    const { supervisor } = fakeSupervisor({ child: fakeChild(4321), runtime });
    const { manager, storage } = await createManager(supervisor);

    const process = await startFakeProcess(manager, storage);
    const persisted = await readJsonFile<ProcessRecord>(
      join(storage.paths.home, "proc", process.id, "process.json"),
    );

    assert.deepEqual(manager.getProcess(process.id).runtime, runtime);
    assert.deepEqual(persisted.runtime, runtime);
  });

  it("hydrates active persisted records as orphaned and preserves runtime", async () => {
    const runtime = runtimeMetadata({ childPid: 4321, processGroupId: 4321 });
    const { supervisor } = fakeSupervisor({ child: fakeChild(4321), runtime });
    const { manager, storage, index, launchConfigs } =
      await createManager(supervisor);
    const process = await startFakeProcess(manager, storage);

    const hydrated = new ProcessManager(
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

    const record = hydrated.getProcess(process.id);
    assert.equal(record.status, "orphaned");
    assert.deepEqual(record.runtime, runtime);
    assert.match(record.error ?? "", /process_stop/);
  });
});

describe("process manager launch env", () => {
  it("stores env config-side and exposes only redacted envInfo", async () => {
    const env = { PORT: "4321", API_TOKEN: "secret" };
    const { supervisor, spawnCalls } = fakeSupervisor({});
    const { manager, storage, events, launchConfigs } =
      await createManager(supervisor);

    const process = await startFakeProcess(manager, storage, env);
    const persisted = await readJsonFile<Record<string, unknown>>(
      join(storage.paths.home, "proc", process.id, "process.json"),
    );
    const launchConfig = await launchConfigs.read(process.id);

    assert.deepEqual(spawnCalls[0]?.options.env, env);
    assert.deepEqual(process.envInfo, {
      keys: ["API_TOKEN", "PORT"],
      persisted: true,
      redacted: true,
    });
    assert.equal("env" in process, false);
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
    const process = await startFakeProcess(manager, storage, env);
    await manager.stopProcess(process.id);

    const restarted = await manager.restartProcess(process.id);

    assert.equal(spawnCalls.length, 2);
    assert.deepEqual(spawnCalls[1]?.options.env, env);
    assert.equal(restarted.restartedFromProcessId, process.id);
    assert.deepEqual(restarted.envInfo, {
      keys: ["API_TOKEN", "PORT"],
      persisted: true,
      redacted: true,
    });
    assert.equal("env" in restarted, false);
  });

  it("loads restart env before stopping an active process", async () => {
    const env = { API_TOKEN: "secret" };
    const { supervisor, terminateSignals, spawnCalls } = fakeSupervisor({});
    const { manager, storage, launchConfigs } = await createManager(supervisor);
    const process = await startFakeProcess(manager, storage, env);
    await launchConfigs.remove(process.id);

    await assert.rejects(
      () => manager.restartProcess(process.id),
      /launch env is missing/,
    );

    assert.deepEqual(terminateSignals, []);
    assert.equal(spawnCalls.length, 1);
    assert.equal(manager.getProcess(process.id).status, "running");
  });

  it("loads restart env before cleaning an orphaned process", async () => {
    const runtime = runtimeMetadata({ childPid: 4321, processGroupId: 4321 });
    const { supervisor: firstSupervisor } = fakeSupervisor({ runtime });
    const { manager, storage, index, launchConfigs } =
      await createManager(firstSupervisor);
    const process = await startFakeProcess(manager, storage, {
      API_TOKEN: "secret",
    });
    await launchConfigs.remove(process.id);

    const { supervisor, runtimeTerminateSignals, spawnCalls } = fakeSupervisor({
      runtime,
      isRuntimeTargetAlive: () => false,
    });
    const hydrated = new ProcessManager(
      storage,
      new EventBus(storage.paths.home, index),
      index,
      undefined,
      { supervisor, launchConfigs },
    );
    await hydrated.hydrate();

    await assert.rejects(
      () => hydrated.restartProcess(process.id),
      /launch env is missing/,
    );

    assert.deepEqual(runtimeTerminateSignals, []);
    assert.equal(spawnCalls.length, 0);
    assert.equal(hydrated.getProcess(process.id).status, "orphaned");
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
    const process = await startFakeProcess(manager, storage);
    await manager.stopProcess(process.id);

    const restarted = await manager.restartProcess(process.id);

    assert.equal(spawnCalls.length, 2);
    assert.equal(spawnCalls[1]?.options.env, undefined);
    assert.equal(restarted.envInfo, undefined);
  });

  it("deletes launch config when removing a process", async () => {
    const child = fakeChild();
    const { supervisor } = fakeSupervisor({
      child,
      onTerminate(signal) {
        if (signal === "SIGTERM") child.emitClose(0, signal);
      },
    });
    const { manager, storage, launchConfigs } = await createManager(supervisor);
    const process = await startFakeProcess(manager, storage, {
      API_TOKEN: "secret",
    });
    await manager.stopProcess(process.id);

    await manager.removeProcess(process.id);

    assert.equal(await launchConfigs.read(process.id), undefined);
  });

  it("hydrates envInfo without raw env values", async () => {
    const env = { API_TOKEN: "secret", PORT: "4321" };
    const runtime = runtimeMetadata({ childPid: 4321, processGroupId: 4321 });
    const { supervisor } = fakeSupervisor({ runtime });
    const { manager, storage, index, launchConfigs } =
      await createManager(supervisor);
    const process = await startFakeProcess(manager, storage, env);

    const hydrated = new ProcessManager(
      storage,
      new EventBus(storage.paths.home, index),
      index,
      undefined,
      { supervisor: fakeSupervisor({ runtime }).supervisor, launchConfigs },
    );
    await hydrated.hydrate();

    const record = hydrated.getProcess(process.id);
    const persisted = await readJsonFile<Record<string, unknown>>(
      join(storage.paths.home, "proc", process.id, "process.json"),
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
    const process = await startFakeProcess(manager, storage, env);
    const { supervisor, runtimeTerminateSignals, spawnCalls } = fakeSupervisor({
      runtime: replacementRuntime,
      isRuntimeTargetAlive: () => false,
    });
    const hydrated = new ProcessManager(
      storage,
      new EventBus(storage.paths.home, index),
      index,
      undefined,
      { supervisor, launchConfigs },
    );
    await hydrated.hydrate();

    const restarted = await hydrated.restartProcess(process.id);

    assert.deepEqual(runtimeTerminateSignals, ["SIGTERM"]);
    assert.deepEqual(spawnCalls[0]?.options.env, env);
    assert.equal(restarted.restartedFromProcessId, process.id);
    assert.deepEqual(restarted.envInfo, {
      keys: ["API_TOKEN", "PORT"],
      persisted: true,
      redacted: true,
    });
  });
});

describe("process manager log buffering and readiness", () => {
  it("matches readyPattern across stdout chunks", async () => {
    const child = fakeChild();
    const { supervisor } = fakeSupervisor({ child });
    const { manager, storage, events } = await createManager(supervisor);
    const startedEvent = waitForProcessEvent(events, "process.started");

    const start = startFakeProcess(manager, storage, undefined, {
      readyPattern: "ready on port 5173",
      readyTimeoutMs: 1000,
    });
    const started = await startedEvent;
    child.stdout.emit("data", "server ready on ");
    child.stdout.emit("data", "port 5173\n");

    const process = await start;
    const logs = await manager.queryLogs(started.id);

    assert.equal(process.readiness.outcome, "ready");
    assert.equal(process.readiness.matched, "ready on port 5173");
    assert.deepEqual(
      logs.events.map((event) => event.line),
      ["server ready on port 5173"],
    );
  });

  it("matches readyOnUrl across stdout chunks", async () => {
    const child = fakeChild();
    const { supervisor } = fakeSupervisor({ child });
    const { manager, storage, events } = await createManager(supervisor);
    const startedEvent = waitForProcessEvent(events, "process.started");

    const start = startFakeProcess(manager, storage, undefined, {
      readyOnUrl: true,
      readyTimeoutMs: 1000,
    });
    await startedEvent;
    child.stdout.emit("data", "Listening at http://localhost:");
    child.stdout.emit("data", "5173\n");

    const process = await start;

    assert.equal(process.readiness.outcome, "ready");
    assert.equal(process.readiness.matched, "http://localhost:5173");
  });

  it("uses final flush to satisfy readiness before exit", async () => {
    const child = fakeChild();
    const { supervisor } = fakeSupervisor({ child });
    const { manager, storage, events } = await createManager(supervisor);
    const startedEvent = waitForProcessEvent(events, "process.started");

    const start = startFakeProcess(manager, storage, undefined, {
      readyPattern: "final ready",
      readyTimeoutMs: 1000,
    });
    const started = await startedEvent;
    const exitedEvent = waitForProcessEvent(
      events,
      "process.exited",
      started.id,
    );
    child.stdout.emit("data", "final ready");
    child.emitClose(0, null);

    await start;
    await exitedEvent;
    const stored = manager.getProcess(started.id);

    assert.equal(stored.status, "exited");
    assert.equal(stored.readiness.outcome, "ready");
    assert.equal(stored.readiness.matched, "final ready");
  });

  it("flushes buffered stderr before marking process error", async () => {
    const child = fakeChild();
    const { supervisor } = fakeSupervisor({ child });
    const { manager, storage, events } = await createManager(supervisor);
    const process = await startFakeProcess(manager, storage);
    const errorEvent = waitForProcessEvent(events, "process.error", process.id);

    child.stderr.emit("data", "fatal failure");
    child.emit("error", new Error("boom"));
    await errorEvent;

    const logs = await manager.queryLogs(process.id, { mode: "errors" });
    assert.deepEqual(
      logs.events.map((event) => event.line),
      ["fatal failure"],
    );
  });

  it("flushes buffered output during force-finalized stop", async () => {
    const child = fakeChild();
    const { supervisor } = fakeSupervisor({ child });
    const { manager, storage } = await createManager(supervisor);
    const process = await startFakeProcess(manager, storage);

    child.stdout.emit("data", "stopping output");
    const stopped = await manager.stopProcess(process.id, { timeoutMs: 20 });

    const logs = await manager.queryLogs(process.id);
    assert.equal(stopped.status, "stopped");
    assert.deepEqual(
      logs.events.map((event) => event.line),
      ["stopping output"],
    );
  });
});

describe("process manager orphan cleanup", () => {
  it("cleans up an orphaned record with runtime metadata", async () => {
    const runtime = runtimeMetadata();
    const { supervisor, runtimeTerminateSignals } = fakeSupervisor({
      runtime,
      isRuntimeTargetAlive: () => false,
    });
    const { manager, storage, events } = await createManager(supervisor);
    const record = await seedProcessRecord(storage, { runtime });
    await manager.hydrate();

    const stopped = await manager.stopProcess(record.id);

    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.exitCode, null);
    assert.equal(stopped.signal, "SIGTERM");
    assert.deepEqual(runtimeTerminateSignals, ["SIGTERM"]);
    assert.ok(
      events.replaySince(0).some((event) => event.type === "process.exited"),
    );
  });

  it("escalates orphan cleanup to SIGKILL after timeout on non-Windows", async () => {
    const runtime = runtimeMetadata();
    const { supervisor, runtimeTerminateSignals } = fakeSupervisor({
      runtime,
      isRuntimeTargetAlive: () => true,
    });
    const { manager, storage } = await createManager(supervisor);
    const record = await seedProcessRecord(storage, { runtime });
    await manager.hydrate();

    const stopped = await manager.stopProcess(record.id, { timeoutMs: 20 });

    assert.equal(stopped.status, "stopped");
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
    const record = await seedProcessRecord(storage, { runtime });
    await manager.hydrate();

    const stopped = await manager.stopProcess(record.id, { timeoutMs: 100 });

    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.signal, "SIGTERM");
    assert.deepEqual(runtimeTerminateSignals, ["SIGTERM"]);
  });

  it("keeps old orphaned records without runtime metadata and surfaces an error", async () => {
    const { supervisor } = fakeSupervisor({});
    const { manager, storage } = await createManager(supervisor);
    const record = await seedProcessRecord(storage, { runtime: undefined });
    await manager.hydrate();

    await assert.rejects(
      () => manager.stopProcess(record.id),
      /no PID metadata was captured/,
    );

    const stored = manager.getProcess(record.id);
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
    const record = await seedProcessRecord(storage, { runtime });
    await manager.hydrate();

    await assert.rejects(
      () => manager.stopProcess(record.id),
      new RegExp(`spawned on ${mismatchedPlatform} from ${process.platform}`),
    );

    const stored = manager.getProcess(record.id);
    assert.equal(stored.status, "orphaned");
    assert.match(stored.error ?? "", /Cannot clean up process spawned/);
    assert.deepEqual(runtimeTerminateSignals, []);
  });

  it("cleans an orphaned process before restarting", async () => {
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
    const record = await seedProcessRecord(storage, { runtime });
    await manager.hydrate();

    const restarted = await manager.restartProcess(record.id);

    assert.deepEqual(order, ["terminateRuntime:SIGTERM", "spawn"]);
    assert.deepEqual(runtimeTerminateSignals, ["SIGTERM"]);
    assert.equal(manager.getProcess(record.id).status, "stopped");
    assert.equal(restarted.restartedFromProcessId, record.id);
    assert.equal(spawnCommands.length, 1);
  });

  it("does not start a duplicate process when orphan cleanup fails", async () => {
    const runtime = runtimeMetadata();
    const { supervisor, spawnCommands } = fakeSupervisor({
      runtime,
      onTerminateRuntime() {
        return { attempted: false, method: "none", error: "cleanup failed" };
      },
    });
    const { manager, storage } = await createManager(supervisor);
    const record = await seedProcessRecord(storage, { runtime });
    await manager.hydrate();

    await assert.rejects(
      () => manager.restartProcess(record.id),
      /cleanup failed/,
    );

    assert.equal(manager.getProcess(record.id).status, "orphaned");
    assert.equal(spawnCommands.length, 0);
  });
});

class MemoryProcessLaunchConfigStore implements ProcessLaunchConfigStore {
  readonly configs = new Map<string, ProcessLaunchConfig>();

  async write(processId: string, config: ProcessLaunchConfig): Promise<void> {
    this.configs.set(processId, structuredClone(config));
  }

  async read(processId: string): Promise<ProcessLaunchConfig | undefined> {
    const config = this.configs.get(processId);
    return config ? structuredClone(config) : undefined;
  }

  async remove(processId: string): Promise<void> {
    this.configs.delete(processId);
  }
}

async function tempHome(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function createManager(
  supervisor: ProcessSupervisor,
  launchConfigs = new MemoryProcessLaunchConfigStore(),
): Promise<{
  manager: ProcessManager;
  storage: InitializedStorage;
  events: EventBus;
  index: IndexStore;
  launchConfigs: MemoryProcessLaunchConfigStore;
}> {
  const storage = await initializeStorage(await tempHome("nerve-processes-"));
  const index = new IndexStore(storage.paths.sqlitePath);
  index.initialize();
  indexes.push(index);
  const events = new EventBus(storage.paths.home, index);
  return {
    manager: new ProcessManager(storage, events, index, undefined, {
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

function runtimeMetadata(
  overrides: Partial<ProcessRuntime> = {},
): ProcessRuntime {
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
  runtime?: ProcessRuntime;
  onSpawn?: (command: string, options: SpawnManagedProcessOptions) => void;
  onTerminate?: (signal: NodeJS.Signals) => void | Promise<void>;
  onTerminateRuntime?: (
    runtime: ProcessRuntime,
    signal: NodeJS.Signals,
  ) =>
    | TerminateProcessResult
    | undefined
    | Promise<TerminateProcessResult | undefined>;
  isRuntimeTargetAlive?: (
    runtime: ProcessRuntime,
  ) => boolean | Promise<boolean>;
};

function fakeSupervisor(options: FakeSupervisorOptions): {
  supervisor: ProcessSupervisor;
  terminateSignals: NodeJS.Signals[];
  runtimeTerminateSignals: NodeJS.Signals[];
  spawnCommands: string[];
  spawnCalls: Array<{ command: string; options: SpawnManagedProcessOptions }>;
} {
  const child = options.child ?? fakeChild();
  const runtime = options.runtime ?? runtimeMetadata({ childPid: child.pid });
  const terminateSignals: NodeJS.Signals[] = [];
  const runtimeTerminateSignals: NodeJS.Signals[] = [];
  const spawnCommands: string[] = [];
  const spawnCalls: Array<{
    command: string;
    options: SpawnManagedProcessOptions;
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

function waitForProcessEvent(
  events: EventBus,
  type: string,
  processId?: string,
): Promise<ProcessRecord> {
  return new Promise((resolve) => {
    const unsubscribe = events.subscribe((event) => {
      if (event.type !== type) return;
      const data = event.data as { process?: ProcessRecord };
      if (!data.process) return;
      if (processId && data.process.id !== processId) return;
      unsubscribe();
      resolve(data.process);
    });
  });
}

async function startFakeProcess(
  manager: ProcessManager,
  storage: InitializedStorage,
  env?: Record<string, string>,
  patch: Partial<Omit<StartProcessRequest, "cwd" | "command" | "env">> = {},
) {
  return manager.startProcess({
    cwd: storage.paths.home,
    command: "fake long-running command",
    env,
    readyTimeoutMs: 0,
    ...patch,
  });
}

async function seedProcessRecord(
  storage: InitializedStorage,
  patch: Partial<ProcessRecord>,
): Promise<ProcessRecord> {
  const id = patch.id ?? createId("proc");
  const dir = join(storage.paths.home, "proc", id);
  await mkdir(dir, { recursive: true });
  const now = new Date().toISOString();
  const record: ProcessRecord = {
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
  await atomicWriteJson(join(dir, "process.json"), record, 0o600);
  return record;
}
