import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { ProcessManager } from "../src/domains/processes/process-manager.js";
import type { ProcessSupervisor } from "../src/domains/processes/process-supervisor.js";
import { EventBus } from "../src/infrastructure/events/index.js";
import { IndexStore } from "../src/infrastructure/index-store/index.js";
import {
  type InitializedStorage,
  initializeStorage,
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
    const { supervisor, terminateSignals } = fakeSupervisor(child);
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
    const { supervisor } = fakeSupervisor(child);
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
    const { supervisor, terminateSignals } = fakeSupervisor(child, (signal) => {
      if (signal === "SIGTERM") child.emitClose(0, "SIGTERM");
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
    const { supervisor, terminateSignals } = fakeSupervisor(child);
    const { manager, storage } = await createManager(supervisor);
    const process = await startFakeProcess(manager, storage);

    const stopped = await manager.stopProcess(process.id, { timeoutMs: 20 });
    const again = await manager.stopProcess(process.id, { timeoutMs: 20 });

    assert.equal(again.id, stopped.id);
    assert.equal(again.status, "stopped");
    assert.deepEqual(terminateSignals, ["SIGTERM", "SIGKILL"]);
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
}> {
  const storage = await initializeStorage(await tempHome("nerve-processes-"));
  const index = new IndexStore(storage.paths.sqlitePath);
  index.initialize();
  indexes.push(index);
  const events = new EventBus(storage.paths.home, index);
  return {
    manager: new ProcessManager(storage, events, index, undefined, supervisor),
    storage,
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

function fakeSupervisor(
  child: FakeChild,
  onTerminate?: (signal: NodeJS.Signals) => void | Promise<void>,
): { supervisor: ProcessSupervisor; terminateSignals: NodeJS.Signals[] } {
  const terminateSignals: NodeJS.Signals[] = [];
  return {
    terminateSignals,
    supervisor: {
      spawn() {
        return child;
      },
      async terminate(terminatedChild, signal) {
        assert.equal(terminatedChild, child);
        terminateSignals.push(signal);
        await onTerminate?.(signal);
        return { attempted: true, method: "direct-child" };
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
