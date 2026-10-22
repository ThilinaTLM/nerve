import { waitForProcessExit } from "../../../infrastructure/process-host/shell-process.js";
import { OutputReadinessCoordinator } from "../../../infrastructure/process-host/readiness.js";
import type { ChildProcess } from "node:child_process";
import type { LaunchDefinitionPortGuard } from "../model/launch-definition-launch.js";
import type {
  LaunchProcessExit,
  LaunchServicePorts,
  LaunchStartInput,
} from "../application/launch.service.js";
import type { DomainEventPublisherPort } from "../../../core/ports/domain-events.js";
import type { PerformanceDiagnosticsPort } from "../../../core/ports/diagnostics.js";
import type {
  LaunchPortConflictListener,
  LaunchRecord,
} from "@nervekit/contracts/launches";
import type { ApplicationLogger } from "../../../infrastructure/diagnostics/index.js";
import type { WorkbenchNoticePublisher } from "../../../infrastructure/events/index.js";
import type { InitializedStorage } from "../../../infrastructure/storage-bootstrap/index.js";
import {
  createLaunchLogCursor,
  type LaunchLogCursor,
  LaunchLogService,
} from "../application/launch-log.service.js";
import {
  defaultLaunchSupervisor,
  type LaunchSupervisor,
} from "../application/launch-supervisor.js";
import { LaunchRepository } from "../persistence/launch.repository.js";

function createDefinitionPortGuard(
  supervisor: LaunchSupervisor,
): LaunchDefinitionPortGuard {
  const inspect = (port: number) => supervisor.inspectConfiguredPort(port);
  const key = (listener: LaunchPortConflictListener) =>
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

export type WorkbenchManagedLaunch = LaunchLogCursor & {
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
  finalizationPromise?: Promise<LaunchRecord | undefined>;
  terminalPromise?: Promise<LaunchRecord | undefined>;
  resolveTerminal?: (launch: LaunchRecord | undefined) => void;
  readinessTimer?: NodeJS.Timeout;
  readinessPollAbort?: AbortController;
  runtimeTimer?: NodeJS.Timeout;
  readinessPattern?: RegExp;
  timedOut?: boolean;
  onOutput?: LaunchStartInput["onOutput"];
  outputPending?: Promise<void>;
};

export type WorkbenchLaunchResources = {
  launches: Map<string, LaunchRecord>;
  managed: Map<string, WorkbenchManagedLaunch>;
  repository: LaunchRepository;
  logs: LaunchLogService;
  supervisor: LaunchSupervisor;
  ports: LaunchServicePorts;
};

export type WorkbenchLaunchAdapterOptions = {
  supervisor?: LaunchSupervisor;
  diagnostics?: PerformanceDiagnosticsPort;
};

export function createWorkbenchLaunchResources(
  storage: InitializedStorage,
  events: WorkbenchNoticePublisher,
  logger: ApplicationLogger | undefined,
  options: WorkbenchLaunchAdapterOptions,
): WorkbenchLaunchResources {
  const launches = new Map<string, LaunchRecord>();
  const managed = new Map<string, WorkbenchManagedLaunch>();
  const repository = new LaunchRepository(storage);
  const environments = new Map<string, Record<string, string>>();
  const logs = new LaunchLogService(events, {
    publishOutputEvents: false,
    diagnostics: options.diagnostics,
  });
  const supervisor = options.supervisor ?? defaultLaunchSupervisor;
  const readiness = new OutputReadinessCoordinator();

  const eventPublisher: DomainEventPublisherPort = {
    publish: async (event) => {
      await events.publish(event.type, event.data);
      if (event.type === "launch.output")
        options.diagnostics?.count("launch.outputPublication");
    },
  };

  const ports: LaunchServicePorts = {
    clock: { now: () => new Date() },
    ids: {
      next: () => {
        const random = Math.random().toString(36).slice(2);
        return `launch_${Date.now()}_${random}`;
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
      get: async (id) => launches.get(id),
      list: async () => [...launches.values()],
      save: async (launch) => {
        launches.set(launch.id, launch);
        await repository.bundles.initializeLaunch(launch.id);
      },
      remove: async (id) => {
        launches.delete(id);
        managed.delete(id);
        readiness.forget(id);
        await repository.bundles.remove(id);
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
      append: async (launch, stream, chunk) => {
        let state = managed.get(launch.id);
        if (!state) {
          state = {
            ...createLaunchLogCursor(await logs.latestLogSeq(launch.logsPath)),
            stopping: false,
            finalized: false,
          };
          managed.set(launch.id, state);
        }
        readiness.capture(
          launch.id,
          Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk,
        );
        await logs.captureOutput(
          launch,
          state,
          stream,
          chunk,
          async () => undefined,
        );
      },
      query: async (launch, query) => {
        const state = managed.get(launch.id);
        if (state) await logs.persistTailSnapshot(launch, state);
        const outputRetention = state
          ? logs.retention(launch, state)
          : launch.outputRetention;
        return await logs.queryLogs({ ...launch, outputRetention }, query);
      },
      remove: async () => undefined,
      retention: (launch) => {
        const state = managed.get(launch.id);
        return state ? logs.retention(launch, state) : launch.outputRetention;
      },
    },
    readiness: {
      wait: (launch, request) => readiness.wait(launch, request),
    },
    env: {
      persisted: false,
      save: async (id, env) => {
        if (env) environments.set(id, { ...env });
      },
      load: async (launch) => environments.get(launch.id),
      remove: async (launch) => {
        environments.delete(launch.id);
      },
    },
    process: {
      spawn: async (input, callbacks = {}) => {
        await repository.bundles.initializeLaunch(input.launchId);
        const logCursor = createLaunchLogCursor(
          await logs.latestLogSeq(repository.logsPath(input.launchId)),
        );
        const spawned = supervisor.spawn(input.command, {
          cwd: input.cwd,
          env: input.env,
          shellPath: storage.settings.tools.bash.shellPath,
        });
        const { child, runtime, exited, closed } = spawned;
        let resolveTerminal!: (launch: LaunchRecord | undefined) => void;
        const terminalPromise = new Promise<LaunchRecord | undefined>(
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
        const state: WorkbenchManagedLaunch = {
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
        managed.set(input.launchId, state);
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
        const finish = async (exit: LaunchProcessExit) => {
          if (settled) return;
          settled = true;
          state.finalized = true;
          await state.outputPending?.catch(() => undefined);
          const current = launches.get(input.launchId);
          if (current)
            await logs.flushOutputBuffers(
              current,
              state,
              async () => undefined,
            );
          await callbacks.onExit?.(exit);
          readiness.forget(input.launchId);
          resolveTerminal(launches.get(input.launchId));
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
            return launches.get(input.launchId);
          })
          .catch((error: unknown) => {
            void logger?.error("Launch finalization callback failed", {
              launchId: input.launchId,
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
      signal: async (launch, cancelOptions) => {
        const state = managed.get(launch.id);
        if (state) state.stopping = true;
        const child = state?.child;
        if (child) {
          const result = await supervisor.terminate(
            child,
            cancelOptions.signal ?? "SIGTERM",
          );
          if (result.error) throw new Error(result.error);
        } else if (launch.runtime) {
          const result = await supervisor.terminateRuntime(
            launch.runtime,
            cancelOptions.signal ?? "SIGTERM",
          );
          if (result.error) throw new Error(result.error);
        }
        // Process termination must not wait behind output persistence. The
        // close/finalization path drains and flushes pending output.
      },
      inspect: async (launch) => {
        if (managed.get(launch.id)?.child) return "running";
        if (!launch.runtime) return "exited";
        return (await supervisor.isRuntimeTargetAlive(launch.runtime))
          ? "unsupervised_running"
          : "exited";
      },
      waitForExit: async (launch, timeoutMs) => {
        const processExit = managed.get(launch.id)?.exitPromise;
        if (!processExit) return "unavailable";
        const result = await waitForProcessExit(processExit, timeoutMs);
        return result === "timeout"
          ? result
          : {
              exitCode: result.exitCode ?? undefined,
              signal: result.signal ?? undefined,
              exitedAt: new Date().toISOString(),
            };
      },
    },
  };

  return { launches, managed, repository, logs, supervisor, ports };
}
