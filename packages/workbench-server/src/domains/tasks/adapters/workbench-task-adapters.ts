import type { ChildProcess } from "node:child_process";
import type { TaskDefinitionPortGuard } from "../model/task-definition-launch.js";
import type {
  TaskProcessExit,
  TaskServicePorts,
  TaskStartInput,
} from "../application/task-service.js";
import type {
  DomainEventPublisherPort,
  PerformanceDiagnosticsPort,
} from "../../../core/ports.js";
import type {
  StartTaskRequest,
  TaskPortConflictListener,
  TaskRecord,
} from "@nervekit/contracts";
import type { ApplicationLogger } from "../../../infrastructure/diagnostics/index.js";
import type { StreamLogRegistry } from "../../../infrastructure/events/index.js";
import type { RuntimeQueryCache } from "../../../infrastructure/persistence/query-cache/index.js";
import type { InitializedStorage } from "../../../infrastructure/storage-bootstrap/index.js";
import {
  type TaskLaunchConfigStore,
  UnconfiguredTaskLaunchConfigStore,
} from "../persistence/task-launch-config.store.js";
import {
  createTaskLogCursor,
  type TaskLogCursor,
  TaskLogService,
} from "../application/task-log.service.js";
import {
  defaultTaskSupervisor,
  type TaskSupervisor,
} from "../application/task-supervisor.js";
import { TaskRepository } from "../persistence/task.repository.js";

function createDefinitionPortGuard(
  supervisor: TaskSupervisor,
): TaskDefinitionPortGuard {
  const inspect = (port: number) => supervisor.inspectConfiguredPort(port);
  const key = (listener: TaskPortConflictListener) =>
    `${listener.pid}|${listener.identity}`;
  const waitForChange = async (port: number) => {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const current = await inspect(port);
      if (current.length === 0) return current;
    }
    return inspect(port);
  };

  return {
    async prepare(port, approvedListeners) {
      let current = await inspect(port);
      if (current.length === 0 || !approvedListeners) return current;
      const approved = new Set(approvedListeners.map(key));
      if (current.some((listener) => !approved.has(key(listener)))) {
        return current;
      }
      const unique = [
        ...new Map(
          current.map((listener) => [key(listener), listener]),
        ).values(),
      ];
      for (const listener of unique) {
        const result = await supervisor.terminateConfiguredPortListener(
          listener,
          "SIGTERM",
        );
        if (result.error) throw new Error(result.error);
      }
      current = await waitForChange(port);
      if (current.length === 0) return current;
      if (current.some((listener) => !approved.has(key(listener)))) {
        return current;
      }
      for (const listener of [
        ...new Map(current.map((item) => [key(item), item])).values(),
      ]) {
        const result = await supervisor.terminateConfiguredPortListener(
          listener,
          "SIGKILL",
        );
        if (result.error) throw new Error(result.error);
      }
      return waitForChange(port);
    },
  };
}

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
  queryCache: RuntimeQueryCache,
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
    definitionPortGuard: createDefinitionPortGuard(supervisor),
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
        queryCache.upsertTask(task);
        await repository.write(task);
      },
      remove: async (id) => {
        tasks.delete(id);
        managed.delete(id);
        queryCache.deleteTask(id);
        await repository.remove(id);
      },
    },
    logs: {
      paths: (id) => {
        const paths = repository.paths(id);
        return {
          stdoutPath: paths.stdoutPath,
          stderrPath: paths.stderrPath,
          combinedPath: paths.combinedPath,
          logsPath: paths.eventsPath,
        };
      },
      append: async (task, stream, chunk) => {
        let state = managed.get(task.id);
        if (!state) {
          state = {
            ...createTaskLogCursor(await logs.latestLogSeq(task.logsPath)),
            stopping: false,
            finalized: false,
          };
          managed.set(task.id, state);
        }
        readiness.capture(
          task.id,
          Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk,
        );
        await logs.captureOutput(
          task,
          state,
          stream,
          chunk,
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
        await repository.bundles.initializeTask(input.taskId);
        const logCursor = createTaskLogCursor(
          await logs.latestLogSeq(repository.logsPath(input.taskId)),
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
        const queueOutput = (
          stream: "stdout" | "stderr",
          chunk: Buffer | string,
          source?: NodeJS.ReadableStream,
        ) => {
          if (chunk.length === 0) return;
          const canPause = typeof source?.pause === "function";
          if (canPause) source.pause();
          state.outputPending = (state.outputPending ?? Promise.resolve())
            .catch(() => undefined)
            .then(async () => {
              try {
                await callbacks.onOutput?.(stream, chunk);
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
          queueOutput("stdout", chunk, child.stdout ?? undefined),
        );
        child.stderr?.on("data", (chunk: Buffer) =>
          queueOutput("stderr", chunk, child.stderr ?? undefined),
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
            queueOutput("stderr", result.error.message);
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
