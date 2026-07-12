import type { ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, parse } from "node:path";
import type {
  DomainEventPublisherPort,
  TaskProcessExit,
  TaskServicePorts,
  TaskStartInput,
} from "@nervekit/host-runtime";
import type { StartTaskRequest, TaskRecord } from "@nervekit/contracts";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import type { EventBus } from "../../infrastructure/events/index.js";
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
    const immediate = this.matchValue(request, this.output.get(task.id) ?? "");
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
          this.waiters.delete(task.id);
          resolve(value === "ready" ? { outcome: "ready" } : value);
        };
        this.waiters.set(task.id, { request, resolve: finish });
        setTimeout(() => finish("timeout"), timeoutMs);
        if (request.readyUrl)
          void this.pollUrl(request.readyUrl, finish, timeoutMs);
      },
    );
  }

  private match(taskId: string, text: string): void {
    const waiter = this.waiters.get(taskId);
    if (!waiter) return;
    const matched = this.matchValue(waiter.request, text);
    if (matched) waiter.resolve({ outcome: "ready", matched });
  }

  private matchValue(
    request: StartTaskRequest,
    text: string,
  ): string | undefined {
    if (request.readyOnUrl) {
      const url = text.match(/https?:\/\/[^\s)'"]+/i)?.[0];
      if (url && !url.endsWith(":")) return url;
    }
    if (request.readyPattern) {
      const matched = new RegExp(request.readyPattern, "i").exec(text)?.[0];
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
};

export function createWorkbenchTaskResources(
  storage: InitializedStorage,
  events: EventBus,
  index: IndexStore,
  logger: ApplicationLogger | undefined,
  options: WorkbenchTaskAdapterOptions,
): WorkbenchTaskResources {
  const tasks = new Map<string, TaskRecord>();
  const managed = new Map<string, WorkbenchManagedTask>();
  const repository = new TaskRepository(storage);
  const logs = new TaskLogService(events, { publishOutputEvents: false });
  const supervisor = options.supervisor ?? defaultTaskSupervisor;
  const launchConfigs =
    options.launchConfigs ?? new UnconfiguredTaskLaunchConfigStore();
  const readiness = new WorkbenchReadinessCoordinator();

  const eventPublisher: DomainEventPublisherPort = {
    publish: async (event) => {
      await events.publish(event.type, event.data);
    },
  };

  const ports: TaskServicePorts = {
    workspaceRoot: parse(process.cwd()).root,
    clock: { now: () => new Date() },
    ids: {
      next: () => {
        const random = Math.random().toString(36).slice(2);
        return `task_${Date.now()}_${random}`;
      },
    },
    events: eventPublisher,
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
      query: (task, query) => logs.queryLogs(task, query),
      remove: async () => undefined,
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
        const spawned = supervisor.spawn(input.command, {
          cwd: input.cwd,
          env: input.env,
          shellPath: storage.settings.runtime.shellPath,
        });
        const { child, runtime } = spawned;
        let resolveTerminal!: (task: TaskRecord | undefined) => void;
        const terminalPromise = new Promise<TaskRecord | undefined>(
          (resolve) => {
            resolveTerminal = resolve;
          },
        );
        const closePromise = new Promise<{
          exitCode: number | null;
          signal: NodeJS.Signals | null;
        }>((resolve) =>
          child.once("close", (exitCode, signal) =>
            resolve({ exitCode, signal }),
          ),
        );
        const state: WorkbenchManagedTask = {
          ...createTaskLogCursor(
            await logs.latestLogSeq(
              join(repository.taskDir(input.taskId), "logs.jsonl"),
            ),
          ),
          child,
          stopping: false,
          finalized: false,
          closePromise,
          terminalPromise,
          resolveTerminal,
          onOutput: input.onOutput,
        };
        managed.set(input.taskId, state);
        const queueOutput = (stream: "stdout" | "stderr", chunk: unknown) => {
          state.outputPending = (state.outputPending ?? Promise.resolve())
            .catch(() => undefined)
            .then(async () => {
              await callbacks.onOutput?.(stream, String(chunk));
            });
        };
        child.stdout?.on("data", (chunk) => queueOutput("stdout", chunk));
        child.stderr?.on("data", (chunk) => queueOutput("stderr", chunk));
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
        child.on("error", () => {
          void finish({ exitCode: 127, exitedAt: new Date().toISOString() });
        });
        state.finalizationPromise = closePromise.then(
          async ({ exitCode, signal }) => {
            await finish({
              exitCode: exitCode ?? undefined,
              signal: signal ?? undefined,
              exitedAt: new Date().toISOString(),
            });
            return tasks.get(input.taskId);
          },
        );
        return runtime;
      },
      signal: async (task, cancelOptions) => {
        const state = managed.get(task.id);
        if (state) state.stopping = true;
        await state?.outputPending?.catch(() => undefined);
        if (state)
          await logs.flushOutputBuffers(task, state, async () => undefined);
        const child = state?.child;
        if (child)
          await supervisor.terminate(child, cancelOptions.signal ?? "SIGTERM");
        else if (task.runtime)
          await supervisor.terminateRuntime(
            task.runtime,
            cancelOptions.signal ?? "SIGTERM",
          );
      },
      inspect: async (task) => {
        if (managed.get(task.id)?.child) return "running";
        if (!task.runtime) return "exited";
        return (await supervisor.isRuntimeTargetAlive(task.runtime))
          ? "running"
          : "exited";
      },
      waitForExit: async (task, timeoutMs) => {
        const close = managed.get(task.id)?.closePromise;
        if (!close) return "unavailable";
        const result = await Promise.race([
          close,
          new Promise<"timeout">((resolve) =>
            setTimeout(() => resolve("timeout"), timeoutMs),
          ),
        ]);
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
        error: `Task supervision was lost. Use task_cancel for process-tree cleanup before restart or removal.`,
        runtime: task.runtime,
        notifications: task.notifications
          ? { ...task.notifications, enabled: true, terminal: true }
          : task.notifications,
        completion: task.completion
          ? { ...task.completion, inject: true }
          : task.completion,
      }),
      afterRemoved: async (task) => {
        if (task.legacyProcessId)
          await repository.removeLegacyProcess(task.legacyProcessId);
      },
    },
  };

  void logger;
  return { tasks, managed, repository, logs, supervisor, launchConfigs, ports };
}
