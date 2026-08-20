import type { ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type {
  TaskProcessExit,
  TaskServicePorts,
  TaskStartInput,
} from "./task-service.js";
import type {
  DomainEventPublisherPort,
  PerformanceDiagnosticsPort,
} from "../../core/ports.js";
import type { StartTaskRequest, TaskRecord } from "@nervekit/contracts";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import type { IndexStore } from "../../infrastructure/index-store/index.js";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";
import {
  type TaskLaunchConfigStore,
  UnconfiguredTaskLaunchConfigStore,
} from "./task-launch-config.store.js";
import {
  createTaskLogCursor,
  type TaskLogCursor,
  TaskLogService,
} from "./task-log.service.js";
import {
  defaultTaskSupervisor,
  type TaskSupervisor,
} from "./task-supervisor.js";
import { TaskRepository } from "./task.repository.js";

class WorkbenchReadinessCoordinator {
  private readonly output = new Map<string, string>();
  private readonly waiters = new Map<
    string,
    {
      request: StartTaskRequest;
      pattern?: RegExp;
      resolve: (
        value: "ready" | "timeout" | { outcome: "ready"; matched?: string },
      ) => void;
    }
  >();

  capture(taskId: string, text: string): void {
    const combined = `${this.output.get(taskId) ?? ""}${text}`.slice(
      -256 * 1024,
    );
    this.output.set(taskId, combined);
    this.match(taskId, combined);
  }

  async wait(task: TaskRecord, request: StartTaskRequest) {
    const pattern = request.readyPattern
      ? new RegExp(request.readyPattern, "i")
      : undefined;
    const immediate = this.matchValue(
      request,
      this.output.get(task.id) ?? "",
      pattern,
    );
    if (immediate) return { outcome: "ready" as const, matched: immediate };
    const timeoutMs =
      request.readyTimeoutMs ?? (request.readyUrl ? 30_000 : 3_000);
    return new Promise<"timeout" | { outcome: "ready"; matched?: string }>(
      (resolve) => {
        let settled = false;
        const finish = (
          value: "ready" | "timeout" | { outcome: "ready"; matched?: string },
        ) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.waiters.delete(task.id);
          resolve(value === "ready" ? { outcome: "ready" } : value);
        };
        this.waiters.set(task.id, { request, pattern, resolve: finish });
        const timer = setTimeout(() => finish("timeout"), timeoutMs);
        if (request.readyUrl)
          void this.pollUrl(request.readyUrl, finish, timeoutMs);
      },
    );
  }

  private match(taskId: string, text: string): void {
    const waiter = this.waiters.get(taskId);
    if (!waiter) return;
    const matched = this.matchValue(waiter.request, text, waiter.pattern);
    if (matched) waiter.resolve({ outcome: "ready", matched });
  }

  private matchValue(
    request: StartTaskRequest,
    text: string,
    pattern?: RegExp,
  ): string | undefined {
    if (request.readyOnUrl) {
      const url = text.match(/https?:\/\/[^\s)'"]+/i)?.[0];
      if (url && !url.endsWith(":")) return url;
    }
    if (pattern) {
      const matched = pattern.exec(text)?.[0];
      if (matched) return matched;
    }
    return undefined;
  }

  private async pollUrl(
    url: string,
    finish: (
      value: "ready" | "timeout" | { outcome: "ready"; matched?: string },
    ) => void,
    timeoutMs: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        await fetch(url, {
          signal: AbortSignal.timeout(Math.min(500, timeoutMs)),
        });
        finish({ outcome: "ready", matched: url });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }
}

export type WorkbenchManagedTask = TaskLogCursor & {
  child?: ChildProcess;
  stopping: boolean;
  finalized: boolean;
  exitPromise?: Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  }>;
  closePromise?: Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  }>;
  finalizationPromise?: Promise<TaskRecord | undefined>;
  terminalPromise?: Promise<TaskRecord | undefined>;
  resolveTerminal?: (task: TaskRecord | undefined) => void;
  readinessTimer?: NodeJS.Timeout;
  readinessPollAbort?: AbortController;
  runtimeTimer?: NodeJS.Timeout;
  readinessPattern?: RegExp;
  timedOut?: boolean;
  onOutput?: TaskStartInput["onOutput"];
  outputPending?: Promise<void>;
};

export type WorkbenchTaskResources = {
  tasks: Map<string, TaskRecord>;
  managed: Map<string, WorkbenchManagedTask>;
  repository: TaskRepository;
  logs: TaskLogService;
  supervisor: TaskSupervisor;
  launchConfigs: TaskLaunchConfigStore;
  ports: TaskServicePorts;
};

export type WorkbenchTaskAdapterOptions = {
  supervisor?: TaskSupervisor;
  launchConfigs?: TaskLaunchConfigStore;
  diagnostics?: PerformanceDiagnosticsPort;
};

export function createWorkbenchTaskResources(
  storage: InitializedStorage,
  events: StreamLogRegistry,
  index: IndexStore,
  logger: ApplicationLogger | undefined,
  options: WorkbenchTaskAdapterOptions,
): WorkbenchTaskResources {
  const tasks = new Map<string, TaskRecord>();
  const managed = new Map<string, WorkbenchManagedTask>();
  const repository = new TaskRepository(storage);
  const logs = new TaskLogService(events, {
    publishOutputEvents: false,
    diagnostics: options.diagnostics,
  });
  const supervisor = options.supervisor ?? defaultTaskSupervisor;
  const launchConfigs =
    options.launchConfigs ?? new UnconfiguredTaskLaunchConfigStore();
  const readiness = new WorkbenchReadinessCoordinator();

  const eventPublisher: DomainEventPublisherPort = {
    publish: async (event) => {
      await events.publish(event.type, event.data);
      if (event.type === "task.output")
        options.diagnostics?.count("task.outputPublication");
    },
  };

  const ports: TaskServicePorts = {
    clock: { now: () => new Date() },
    ids: {
      next: () => {
        const random = Math.random().toString(36).slice(2);
        return `task_${Date.now()}_${random}`;
      },
    },
    events: eventPublisher,
    diagnostics: logger
      ? {
          debug: (message, data) => {
            void logger.debug(message, { context: { ...data } });
          },
          warn: (message, data) => {
            void logger.warn(message, { context: { ...data } });
          },
          error: (message, data) => {
            void logger.error(message, { context: { ...data } });
          },
        }
      : undefined,
    repository: {
      get: async (id) => tasks.get(id),
      list: async () => [...tasks.values()],
      save: async (task) => {
        tasks.set(task.id, task);
        index.upsertTask(task);
        await repository.write(task);
      },
      remove: async (id) => {
        tasks.delete(id);
        managed.delete(id);
        index.deleteTask(id);
        await repository.remove(id);
      },
    },
    logs: {
      paths: (id) => {
        const dir = repository.taskDir(id);
        return {
          stdoutPath: join(dir, "stdout.log"),
          stderrPath: join(dir, "stderr.log"),
          combinedPath: join(dir, "combined.log"),
          logsPath: join(dir, "logs.jsonl"),
        };
      },
      append: async (task, stream, text) => {
        let state = managed.get(task.id);
        if (!state) {
          state = {
            ...createTaskLogCursor(await logs.latestLogSeq(task.logsPath)),
            stopping: false,
            finalized: false,
          };
          managed.set(task.id, state);
        }
        readiness.capture(task.id, text);
        await logs.captureOutput(
          task,
          state,
          stream,
          text,
          async () => undefined,
        );
      },
      query: async (task, query) => {
        const state = managed.get(task.id);
        if (state) await logs.persistTailSnapshot(task, state);
        const outputRetention = state
          ? logs.retention(task, state)
          : task.outputRetention;
        return await logs.queryLogs({ ...task, outputRetention }, query);
      },
      remove: async () => undefined,
      retention: (task) => {
        const state = managed.get(task.id);
        return state ? logs.retention(task, state) : task.outputRetention;
      },
    },
    readiness: {
      wait: (task, request) => readiness.wait(task, request),
    },
    launchConfigs: {
      save: async (taskId, env) => {
        if (!env) return;
        const now = new Date().toISOString();
        await launchConfigs.write(taskId, {
          version: 1,
          env,
          createdAt: now,
          updatedAt: now,
        });
      },
      load: async (task) => {
        const config = await launchConfigs.read(task.id);
        if (task.envInfo?.persisted && !config)
          throw new Error("Task launch env is missing.");
        return config?.env;
      },
      remove: (task) => launchConfigs.remove(task.id),
    },
    process: {
      spawn: async (input, callbacks = {}) => {
        await mkdir(repository.taskDir(input.taskId), {
          recursive: true,
          mode: 0o755,
        });
        const logCursor = createTaskLogCursor(
          await logs.latestLogSeq(
            join(repository.taskDir(input.taskId), "logs.jsonl"),
          ),
        );
        const spawned = supervisor.spawn(input.command, {
          cwd: input.cwd,
          env: input.env,
          shellPath: storage.settings.runtime.shellPath,
        });
        const { child, runtime, exited, closed } = spawned;
        let resolveTerminal!: (task: TaskRecord | undefined) => void;
        const terminalPromise = new Promise<TaskRecord | undefined>(
          (resolve) => {
            resolveTerminal = resolve;
          },
        );
        const terminalResult = (result: Awaited<typeof exited>) =>
          result.kind === "error"
            ? { exitCode: 127, signal: null }
            : { exitCode: result.exitCode, signal: result.signal };
        const exitPromise = exited.then(terminalResult);
        const closePromise = closed.then(terminalResult);
        const state: WorkbenchManagedTask = {
          ...logCursor,
          child,
          stopping: false,
          finalized: false,
          exitPromise,
          closePromise,
          terminalPromise,
          resolveTerminal,
          onOutput: input.onOutput,
        };
        managed.set(input.taskId, state);
        const decoders = {
          stdout: new StringDecoder("utf8"),
          stderr: new StringDecoder("utf8"),
        };
        const queueDecodedOutput = (
          stream: "stdout" | "stderr",
          text: string,
          source?: NodeJS.ReadableStream,
        ) => {
          if (!text) return;
          const canPause = typeof source?.pause === "function";
          if (canPause) source.pause();
          state.outputPending = (state.outputPending ?? Promise.resolve())
            .catch(() => undefined)
            .then(async () => {
              try {
                await callbacks.onOutput?.(stream, text);
              } finally {
                if (canPause && typeof source?.resume === "function") {
                  source.resume();
                }
              }
            });
        };
        const streamCompletion = (stream: NodeJS.ReadableStream | null) => {
          if (!stream) return Promise.resolve();
          return new Promise<void>((resolve) => {
            let complete = false;
            const finish = () => {
              if (complete) return;
              complete = true;
              resolve();
            };
            stream.once("end", finish);
            stream.once("close", finish);
            stream.once("error", finish);
          });
        };
        child.stdout?.on("data", (chunk: Buffer) =>
          queueDecodedOutput(
            "stdout",
            decoders.stdout.write(chunk),
            child.stdout ?? undefined,
          ),
        );
        child.stderr?.on("data", (chunk: Buffer) =>
          queueDecodedOutput(
            "stderr",
            decoders.stderr.write(chunk),
            child.stderr ?? undefined,
          ),
        );
        const outputCompleted = Promise.all([
          streamCompletion(child.stdout),
          streamCompletion(child.stderr),
        ]);
        let settled = false;
        const finish = async (exit: TaskProcessExit) => {
          if (settled) return;
          settled = true;
          state.finalized = true;
          queueDecodedOutput("stdout", decoders.stdout.end());
          queueDecodedOutput("stderr", decoders.stderr.end());
          await state.outputPending?.catch(() => undefined);
          const current = tasks.get(input.taskId);
          if (current)
            await logs.flushOutputBuffers(
              current,
              state,
              async () => undefined,
            );
          await callbacks.onExit?.(exit);
          resolveTerminal(tasks.get(input.taskId));
        };
        void closed.then((result) => {
          if (result.kind === "error")
            queueDecodedOutput("stderr", result.error.message);
        });
        state.finalizationPromise = Promise.all([closePromise, outputCompleted])
          .then(async ([{ exitCode, signal }]) => {
            await finish({
              exitCode: exitCode ?? undefined,
              signal: signal ?? undefined,
              exitedAt: new Date().toISOString(),
            });
            return tasks.get(input.taskId);
          })
          .catch((error: unknown) => {
            void logger?.error("Task finalization callback failed", {
              taskId: input.taskId,
              error,
            });
            return undefined;
          });
        try {
          return await runtime;
        } catch (error) {
          const termination = await supervisor.terminate(child, "SIGKILL");
          if (termination.error) {
            throw new Error(
              `Runtime identity failed and process termination failed: ${termination.error}`,
              { cause: error },
            );
          }
          throw error;
        }
      },
      signal: async (task, cancelOptions) => {
        const state = managed.get(task.id);
        if (state) state.stopping = true;
        const child = state?.child;
        if (child) {
          const result = await supervisor.terminate(
            child,
            cancelOptions.signal ?? "SIGTERM",
          );
          if (result.error) throw new Error(result.error);
        } else if (task.runtime) {
          const result = await supervisor.terminateRuntime(
            task.runtime,
            cancelOptions.signal ?? "SIGTERM",
          );
          if (result.error) throw new Error(result.error);
        }
        // Process termination must not wait behind output persistence. The
        // close/finalization path drains and flushes pending output.
      },
      inspect: async (task) => {
        if (managed.get(task.id)?.child) return "running";
        if (!task.runtime) return "exited";
        return (await supervisor.isRuntimeTargetAlive(task.runtime))
          ? "unsupervised_running"
          : "exited";
      },
      waitForExit: async (task, timeoutMs) => {
        const processExit = managed.get(task.id)?.exitPromise;
        if (!processExit) return "unavailable";
        const result = await new Promise<
          "timeout" | { exitCode: number | null; signal: NodeJS.Signals | null }
        >((resolve) => {
          const timer = setTimeout(() => resolve("timeout"), timeoutMs);
          void processExit.then((exit) => {
            clearTimeout(timer);
            resolve(exit);
          });
        });
        return result === "timeout"
          ? result
          : {
              exitCode: result.exitCode ?? undefined,
              signal: result.signal ?? undefined,
              exitedAt: new Date().toISOString(),
            };
      },
      inspectPorts: async (task) => {
        if (!task.runtime) return "unavailable";
        return (
          await supervisor.inspectRuntimeListeningPorts(task.runtime)
        ).map((listener) => listener.port);
      },
    },
    capabilities: {
      prepareOrphan: async (task) => ({
        visibility: "background",
        error: `Task supervision was lost. Use task_control with action "stop" for process-tree cleanup before restart or removal.`,
        runtime: task.runtime,
        notifications: task.notifications
          ? { ...task.notifications, enabled: true, terminal: true }
          : task.notifications,
        completion: task.completion
          ? { ...task.completion, inject: true }
          : task.completion,
      }),
    },
  };

  return { tasks, managed, repository, logs, supervisor, launchConfigs, ports };
}
