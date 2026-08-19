import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type {
  TaskListeningPort,
  TaskRuntime,
  TaskRuntimeIdentity,
  WorkerExecutionSnapshot,
  WorkerTerminationResult,
} from "@nervekit/contracts";
import {
  ExecutionWorkerClient,
  isRetryableConnectionError,
} from "@nervekit/native";
import { resolveBashShellConfig } from "@nervekit/tools";
import {
  defaultTaskPortInspector,
  type TaskPortInspector,
} from "./task-port-inspector.js";

export interface SpawnManagedTaskOptions {
  executionId: string;
  cwd: string;
  env?: Record<string, string>;
  shellPath?: string;
  timeoutMs?: number;
}

export type ProcessLifecycleResult =
  | {
      kind: "closed";
      exitCode: number | null;
      signal: NodeJS.Signals | null;
    }
  | { kind: "error"; error: Error };

export interface SpawnedManagedTask {
  child: ChildProcess;
  runtime: Promise<TaskRuntime>;
  exited: Promise<ProcessLifecycleResult>;
  closed: Promise<ProcessLifecycleResult>;
}

export interface TerminateTaskResult {
  attempted: boolean;
  terminated: boolean;
  method: string;
  error?: string;
}

export interface TaskSupervisor {
  spawn(
    command: string,
    options: SpawnManagedTaskOptions,
  ): Promise<SpawnedManagedTask>;
  attach(runtime: TaskRuntime): Promise<SpawnedManagedTask>;
  terminate(
    child: ChildProcess,
    signal: NodeJS.Signals,
  ): Promise<TerminateTaskResult>;
  terminateRuntime(
    runtime: TaskRuntime,
    signal: NodeJS.Signals,
  ): Promise<TerminateTaskResult>;
  removeRuntime(runtime: TaskRuntime): Promise<void>;
  isRuntimeTargetAlive(runtime: TaskRuntime): Promise<boolean>;
  inspectRuntimeListeningPorts(
    runtime: TaskRuntime,
  ): Promise<TaskListeningPort[]>;
  inspectPortListeners(
    ports: TaskListeningPort[],
  ): Promise<TaskListeningPort[]>;
}

export function managedTaskShellCommand(
  command: string,
  shellPath?: string,
): { shell: string; args: string[] } {
  const shellConfig = resolveBashShellConfig({ shellPath });
  return {
    shell: shellConfig.shell,
    args: [...shellConfig.args, command],
  };
}

export function createTaskSupervisor(
  storageHome: string,
  portInspector: TaskPortInspector = defaultTaskPortInspector,
  initialWorker?: Promise<ExecutionWorkerClient>,
): TaskSupervisor {
  const executions = new WeakMap<ChildProcess, string>();
  let workerPromise = initialWorker;
  const getWorker = () =>
    (workerPromise ??= ExecutionWorkerClient.connect(storageHome));
  const invalidateWorker = () => {
    workerPromise = undefined;
  };
  /** Run against the memoized worker, reconnecting once on a dead/moved worker. */
  const withWorker = async <T>(
    run: (worker: ExecutionWorkerClient) => Promise<T>,
  ): Promise<T> => {
    let worker = await getWorker();
    try {
      return await run(worker);
    } catch (error) {
      if (!isRetryableConnectionError(error)) throw error;
      invalidateWorker();
      worker = await getWorker();
      return await run(worker);
    }
  };
  return {
    async spawn(command, options) {
      const shell = managedTaskShellCommand(command, options.shellPath);
      return withWorker(async (worker) => {
        const snapshot =
          (await worker.get(options.executionId)) ??
          (await worker.start({
            executionId: options.executionId,
            command: shell.shell,
            args: shell.args,
            cwd: options.cwd,
            env: processEnvironment(options.env),
            timeoutMs: options.timeoutMs,
            terminationGraceMs: 2_000,
            belowNormalPriority: true,
          }));
        const health = await worker.health();
        return spawnedForSnapshot(
          worker,
          snapshot,
          `worker_${health.pid}`,
          executions,
        );
      });
    },
    async attach(runtime) {
      if (!runtime.workerExecutionId) {
        throw new Error("Task runtime is not worker-backed.");
      }
      return withWorker(async (worker) => {
        const snapshot = await worker.get(runtime.workerExecutionId);
        if (!snapshot) throw new Error("Worker execution was not found.");
        return spawnedForSnapshot(
          worker,
          snapshot,
          runtime.workerInstanceId ?? "worker_unknown",
          executions,
          runtime.outputCursor ?? 0,
        );
      });
    },
    async terminate(child, signal) {
      const executionId = executions.get(child);
      if (!executionId) {
        return {
          attempted: false,
          terminated: false,
          method: "none",
          error: "Child is not owned by the execution worker",
        };
      }
      return normalizeTermination(
        await withWorker((worker) => worker.cancel(executionId, signal)),
      );
    },
    async terminateRuntime(runtime, signal) {
      if (!runtime.workerExecutionId) {
        return {
          attempted: false,
          terminated: false,
          method: "none",
          error: "Task runtime is not worker-backed",
        };
      }
      return normalizeTermination(
        await withWorker((worker) =>
          worker.cancel(runtime.workerExecutionId as string, signal),
        ),
      );
    },
    async removeRuntime(runtime) {
      if (!runtime.workerExecutionId) return;
      await withWorker((worker) =>
        worker.remove(runtime.workerExecutionId as string),
      );
    },
    async isRuntimeTargetAlive(runtime) {
      if (!runtime.workerExecutionId) return false;
      const snapshot = await withWorker((worker) =>
        worker.get(runtime.workerExecutionId as string),
      );
      return snapshot?.status === "starting" || snapshot?.status === "running";
    },
    async inspectRuntimeListeningPorts(runtime) {
      if (!(await this.isRuntimeTargetAlive(runtime))) return [];
      return portInspector.inspectRuntime(runtime);
    },
    inspectPortListeners: (ports) => portInspector.inspectListeners(ports),
  };
}

function spawnedForSnapshot(
  worker: ExecutionWorkerClient,
  snapshot: WorkerExecutionSnapshot,
  workerInstanceId: string,
  executions: WeakMap<ChildProcess, string>,
  afterCursor = 0,
): SpawnedManagedTask {
  if (!snapshot.target) {
    throw new Error("Execution worker did not return a process target.");
  }
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = new EventEmitter() as ChildProcess;
  Object.defineProperties(child, {
    pid: { value: snapshot.target.pid, enumerable: true },
    stdout: { value: stdout, enumerable: true },
    stderr: { value: stderr, enumerable: true },
    stdin: { value: null, enumerable: true },
    exitCode: { value: null, writable: true, enumerable: true },
    signalCode: { value: null, writable: true, enumerable: true },
    killed: { value: false, writable: true, enumerable: true },
  });
  child.kill = (signal = "SIGTERM") => {
    Reflect.set(child, "killed", true);
    void worker.cancel(
      snapshot.executionId,
      typeof signal === "string" ? signal : "SIGTERM",
    );
    return true;
  };
  executions.set(child, snapshot.executionId);
  const terminal = worker
    .subscribe(snapshot.executionId, {
      afterCursor,
      onOutput: (stream, chunk) => {
        (stream === "stdout" ? stdout : stderr).write(chunk);
      },
      onCursor: (cursor) => {
        child.emit("workerCursor", cursor);
      },
    })
    .settled.then((terminalSnapshot) => {
      stdout.end();
      stderr.end();
      const result = lifecycleResult(terminalSnapshot);
      if (result.kind === "closed") {
        Reflect.set(child, "exitCode", result.exitCode);
        Reflect.set(child, "signalCode", result.signal);
        child.emit("exit", result.exitCode, result.signal);
        child.emit("close", result.exitCode, result.signal);
      }
      return result;
    })
    .catch((error: unknown) => {
      stdout.destroy();
      stderr.destroy();
      const result = {
        kind: "error" as const,
        error: error instanceof Error ? error : new Error(String(error)),
      };
      child.emit("error", result.error);
      return result;
    });
  return {
    child,
    runtime: Promise.resolve(
      runtimeForWorkerSnapshot(snapshot, workerInstanceId, afterCursor),
    ),
    exited: terminal,
    closed: terminal,
  };
}

function runtimeForWorkerSnapshot(
  snapshot: WorkerExecutionSnapshot,
  workerInstanceId: string,
  outputCursor: number,
): TaskRuntime {
  const target = snapshot.target;
  if (!target) throw new Error("Worker execution has no process target.");
  return {
    version: 3,
    platform: process.platform,
    childPid: target.pid,
    processGroupId: target.processGroupId,
    detached: target.containment === "process-group",
    shell: true,
    containment:
      target.containment === "job-object" ? "job-object" : "process-group",
    spawnedAt: new Date(snapshot.startedAtMs).toISOString(),
    identity: runtimeIdentity(target.identity),
    workerExecutionId: snapshot.executionId,
    workerInstanceId,
    outputCursor,
    capabilities: {
      identity: true,
      processTree: true,
      listeningPorts: ["linux", "darwin", "win32"].includes(process.platform),
      priority: true,
      durableOutput: true,
      daemonRestartRecovery: true,
      detail: `worker:${target.containment}`,
    },
  };
}

function runtimeIdentity(identity: string): TaskRuntimeIdentity {
  if (identity.startsWith("linux:")) {
    const startTimeTicks = Number(identity.slice("linux:".length));
    if (Number.isSafeInteger(startTimeTicks) && startTimeTicks >= 0) {
      return { kind: "linux", startTimeTicks };
    }
  }
  if (identity.startsWith("darwin:")) {
    return { kind: "darwin", startFingerprint: identity };
  }
  if (identity.startsWith("win32:")) {
    return { kind: "win32", creationDate: identity };
  }
  throw new Error(
    `Execution worker returned an unsupported identity: ${identity}`,
  );
}

function lifecycleResult(
  snapshot: WorkerExecutionSnapshot,
): ProcessLifecycleResult {
  return {
    kind: "closed",
    exitCode: snapshot.exitCode ?? null,
    signal: (snapshot.signal as NodeJS.Signals | undefined) ?? null,
  };
}

function normalizeTermination(
  result: WorkerTerminationResult,
): TerminateTaskResult {
  return {
    attempted: result.attempted,
    terminated: result.terminated,
    method: result.method,
    error: result.error ?? undefined,
  };
}

function processEnvironment(
  overrides: Record<string, string> | undefined,
): Record<string, string> {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  return {
    ...inherited,
    PAGER: "cat",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    TERM: "dumb",
    ...overrides,
  };
}
