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
  type ProcessRecord,
  type ProcessRuntime,
} from "@nerve/shared";
import { ProcessManager } from "../src/domains/processes/process-manager.js";
import type {
  ProcessSupervisor,
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
    const { manager, storage, index } = await createManager(supervisor);
    const process = await startFakeProcess(manager, storage);

    const hydrated = new ProcessManager(
      storage,
      new EventBus(storage.paths.home, index),
      index,
      undefined,
      fakeSupervisor({ runtime }).supervisor,
    );
    await hydrated.hydrate();

    const record = hydrated.getProcess(process.id);
    assert.equal(record.status, "orphaned");
    assert.deepEqual(record.runtime, runtime);
    assert.match(record.error ?? "", /process_stop/);
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

async function tempHome(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function createManager(supervisor: ProcessSupervisor): Promise<{
  manager: ProcessManager;
  storage: InitializedStorage;
  events: EventBus;
  index: IndexStore;
}> {
  const storage = await initializeStorage(await tempHome("nerve-processes-"));
  const index = new IndexStore(storage.paths.sqlitePath);
  index.initialize();
  indexes.push(index);
  const events = new EventBus(storage.paths.home, index);
  return {
    manager: new ProcessManager(storage, events, index, undefined, supervisor),
    storage,
    events,
    index,
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
  onSpawn?: (command: string) => void;
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
} {
  const child = options.child ?? fakeChild();
  const runtime = options.runtime ?? runtimeMetadata({ childPid: child.pid });
  const terminateSignals: NodeJS.Signals[] = [];
  const runtimeTerminateSignals: NodeJS.Signals[] = [];
  const spawnCommands: string[] = [];
  return {
    terminateSignals,
    runtimeTerminateSignals,
    spawnCommands,
    supervisor: {
      spawn(command) {
        spawnCommands.push(command);
        options.onSpawn?.(command);
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

async function startFakeProcess(
  manager: ProcessManager,
  storage: InitializedStorage,
) {
  return manager.startProcess({
    cwd: storage.paths.home,
    command: "fake long-running command",
    readyTimeoutMs: 0,
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
