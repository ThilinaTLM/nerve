import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import {
  createId,
  type StartTaskRequest,
  type TaskLaunchConfig,
  type TaskListeningPort,
  type TaskRecord,
  type TaskRuntime,
} from "@nervekit/contracts";
import type { TaskLaunchConfigStore } from "../../src/domains/tasks/task-launch-config.store.js";
import { TaskManager } from "../../src/domains/tasks/task-manager.js";
import type {
  SpawnManagedTaskOptions,
  TaskSupervisor,
  TerminateTaskResult,
} from "../../src/domains/tasks/task-supervisor.js";
import { EventBus } from "../../src/infrastructure/events/index.js";
import { IndexStore } from "../../src/infrastructure/index-store/index.js";
import {
  atomicWriteJson,
  type InitializedStorage,
  initializeStorage,
} from "../../src/infrastructure/storage/index.js";

export interface FakeChild extends ChildProcess {
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

export class MemoryTaskLaunchConfigStore implements TaskLaunchConfigStore {
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

export async function tempHome(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

export async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
}

export async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function createManager(
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

export function fakeChild(pid = 1234): FakeChild {
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

export function runtimeMetadata(
  overrides: Partial<TaskRuntime> = {},
): TaskRuntime {
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

export type FakeSupervisorOptions = {
  child?: FakeChild | FakeChild[];
  runtime?: TaskRuntime | TaskRuntime[];
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
  inspectRuntimeListeningPorts?: (
    runtime: TaskRuntime,
  ) => TaskListeningPort[] | Promise<TaskListeningPort[]>;
  inspectPortListeners?: (
    ports: TaskListeningPort[],
  ) => TaskListeningPort[] | Promise<TaskListeningPort[]>;
};

export function fakeSupervisor(options: FakeSupervisorOptions): {
  supervisor: TaskSupervisor;
  terminateSignals: NodeJS.Signals[];
  runtimeTerminateSignals: NodeJS.Signals[];
  spawnCommands: string[];
  spawnCalls: Array<{ command: string; options: SpawnManagedTaskOptions }>;
} {
  const children = Array.isArray(options.child)
    ? options.child
    : [options.child ?? fakeChild()];
  const runtimes = Array.isArray(options.runtime)
    ? options.runtime
    : [options.runtime];
  let spawnIndex = 0;
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
        const index = Math.min(spawnIndex, children.length - 1);
        spawnIndex += 1;
        const child = children[index] ?? children[0] ?? fakeChild();
        const runtime =
          runtimes[index] ??
          runtimes[0] ??
          runtimeMetadata({ childPid: child.pid });
        spawnCommands.push(command);
        spawnCalls.push({ command, options: spawnOptions });
        options.onSpawn?.(command, spawnOptions);
        return { child, runtime };
      },
      async terminate(terminatedChild, signal) {
        assert.ok(children.includes(terminatedChild as FakeChild));
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
      async inspectRuntimeListeningPorts(targetRuntime) {
        return options.inspectRuntimeListeningPorts?.(targetRuntime) ?? [];
      },
      async inspectPortListeners(ports) {
        return options.inspectPortListeners?.(ports) ?? [];
      },
    },
  };
}

export function waitForTaskEvent(
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

export async function startFakeTask(
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

export async function seedTaskRecord(
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
