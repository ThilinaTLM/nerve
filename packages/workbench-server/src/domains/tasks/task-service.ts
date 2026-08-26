import path from "node:path";
import type {
  StartTaskRequest,
  TaskPortConflictListener,
  TaskLogQuery,
  TaskLogQueryResponse,
  TaskOutputRetention,
  TaskRecord,
} from "@nervekit/contracts";
import type { ToolExecutionOutputUpdate } from "@nervekit/tools";
import type {
  ClockPort,
  DiagnosticPort,
  DomainEventPublisherPort,
  IdPort,
} from "../../core/ports.js";
import {
  inspectDefinitionPort,
  type TaskDefinitionLaunchOutcome,
  type TaskDefinitionPortGuard,
} from "./task-definition-launch.js";
import { TaskProcessSupervisor } from "./task-process-supervisor.js";
import { isTerminalTaskStatus } from "./task-status.js";

export { isTerminalTaskStatus } from "./task-status.js";

export type TaskProcessEvidence =
  | "running"
  | "unsupervised_running"
  | "alive_verified"
  | "exited"
  | "exited_verified"
  | "identity_mismatch"
  | "unknown";
export type TaskCapabilityResult<T> = T | "unavailable";

export interface TaskRepositoryPort {
  get(id: string): Promise<TaskRecord | undefined>;
  list(): Promise<TaskRecord[]>;
  save(task: TaskRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface TaskProcessExit {
  readonly exitCode?: number;
  readonly signal?: string;
  readonly exitedAt: string;
}

export interface TaskProcessCallbacks {
  readonly onOutput?: (
    stream: "stdout" | "stderr",
    chunk: Buffer | string,
  ) => void | Promise<void>;
  readonly onExit?: (exit: TaskProcessExit) => void | Promise<void>;
}

export interface TaskProcessPort {
  spawn(
    input: TaskStartInput & { taskId: string },
    callbacks?: TaskProcessCallbacks,
  ): Promise<TaskRecord["runtime"]>;
  signal(task: TaskRecord, options: TaskCancelOptions): Promise<void>;
  inspect(task: TaskRecord): Promise<TaskProcessEvidence>;
  waitForExit?(
    task: TaskRecord,
    timeoutMs: number,
  ): Promise<TaskCapabilityResult<TaskProcessExit | "timeout">>;
  inspectPorts?(
    task: TaskRecord,
  ): Promise<TaskCapabilityResult<readonly number[]>>;
  releasePorts?(
    task: TaskRecord,
    ports: readonly number[],
  ): Promise<TaskCapabilityResult<readonly number[]>>;
}

export interface TaskLogPort {
  query(task: TaskRecord, query: TaskLogQuery): Promise<TaskLogQueryResponse>;
  append?(
    task: TaskRecord,
    stream: "stdout" | "stderr",
    chunk: Buffer | string,
  ): Promise<void>;
  remove(task: TaskRecord): Promise<void>;
  retention?(task: TaskRecord): TaskOutputRetention | undefined;
  paths?(taskId: string): {
    stdoutPath: string;
    stderrPath: string;
    logsPath: string;
    combinedPath?: string;
  };
}

export type TaskReadinessOutcome =
  | "ready"
  | "timeout"
  | "exited"
  | "unavailable"
  | { outcome: "ready"; matched?: string };

export interface TaskReadinessPort {
  wait(
    task: TaskRecord,
    request: StartTaskRequest,
  ): Promise<TaskReadinessOutcome>;
}

export interface TaskCancelOptions {
  readonly signal?: "SIGTERM" | "SIGINT" | "SIGKILL";
  readonly timeoutMs?: number;
  readonly reason?: string;
}

export interface TaskNotificationPort {
  notify(
    task: TaskRecord,
    event: "ready" | "completed" | "failed",
  ): Promise<void>;
}

export interface TaskLaunchConfigPort {
  save(taskId: string, env: Record<string, string> | undefined): Promise<void>;
  load(task: TaskRecord): Promise<Record<string, string> | undefined>;
  remove(task: TaskRecord): Promise<void>;
}

export interface TaskOptionalCapabilitiesPort {
  promoteForeground?(
    task: TaskRecord,
  ): Promise<TaskCapabilityResult<TaskRecord>>;
  injectCompletion?(task: TaskRecord): Promise<TaskCapabilityResult<void>>;
  prepareOrphan?(
    task: TaskRecord,
  ): Promise<Partial<Omit<TaskRecord, "id" | "startedAt">>>;
  afterSaved?(task: TaskRecord): Promise<void>;
  afterRemoved?(task: TaskRecord): Promise<void>;
}

export interface TaskTimerPort {
  sleep(ms: number): Promise<void>;
}

export interface TaskServicePorts {
  readonly repository: TaskRepositoryPort;
  readonly process: TaskProcessPort;
  readonly logs: TaskLogPort;
  readonly readiness?: TaskReadinessPort;
  readonly events: DomainEventPublisherPort;
  readonly clock: ClockPort;
  readonly ids: IdPort;
  readonly notifications?: TaskNotificationPort;
  readonly launchConfigs?: TaskLaunchConfigPort;
  readonly capabilities?: TaskOptionalCapabilitiesPort;
  readonly timers?: TaskTimerPort;
  readonly diagnostics?: DiagnosticPort;
  readonly definitionPortGuard?: TaskDefinitionPortGuard;
  readonly stopTimeoutMs?: number;
}

export type TaskStartInput = StartTaskRequest & {
  readonly origin?: TaskRecord["origin"];
  readonly visibility?: TaskRecord["visibility"];
  readonly completion?: TaskRecord["completion"];
  readonly notifications?: TaskRecord["notifications"];
  readonly restartedFromTaskId?: string;
  readonly restartRootTaskId?: string;
  readonly restartGeneration?: number;
  readonly onOutput?: (
    update: ToolExecutionOutputUpdate,
  ) => void | Promise<void>;
};

export class TaskService {
  private readonly definitionLaunches = new Map<
    string,
    Promise<TaskDefinitionLaunchOutcome>
  >();
  private readonly stopReasons = new Map<string, "cancelled" | "timed_out">();
  private readonly startCallbacks = new Map<
    string,
    NonNullable<TaskStartInput["onOutput"]>
  >();
  private readonly transitions = new Map<string, Promise<unknown>>();
  private readonly terminalFailures = new Map<
    string,
    { readonly exit: TaskProcessExit; readonly error: unknown }
  >();
  private readonly processSupervisor: TaskProcessSupervisor;

  constructor(private readonly ports: TaskServicePorts) {
    this.processSupervisor = new TaskProcessSupervisor({
      process: ports.process,
      logs: ports.logs,
      readiness: ports.readiness,
      timers: ports.timers,
      stopTimeoutMs: ports.stopTimeoutMs ?? 5_000,
      get: (id) => this.get(id),
      transitionIfPresent: (id, change) => this.transitionIfPresent(id, change),
      save: (task) => this.save(task),
      publish: (type, data, delivery) => this.publish(type, data, delivery),
      safeNotify: (task, event) => this.safeNotify(task, event),
      now: () => this.now(),
      finishFromExit: (id, exit, forcedStatus, reason) =>
        this.finishFromExit(id, exit, forcedStatus, reason),
      outputObserver: async (id, update) => {
        await this.startCallbacks.get(id)?.(update);
      },
      setStopReason: (id, reason) => this.stopReasons.set(id, reason),
      getStopReason: (id) => this.stopReasons.get(id),
      clearStopReason: (id) => this.stopReasons.delete(id),
      clearTerminalFailure: (id) => this.terminalFailures.delete(id),
      saveTerminalFailure: (id, exit, error) =>
        this.terminalFailures.set(id, { exit, error }),
      reportFailure: (kind, id, error) => this.reportFailure(kind, id, error),
    });
  }

  async start(request: TaskStartInput): Promise<TaskRecord> {
    const cwd = resolveTaskWorkingDirectory(request.cwd);
    if (!request.command.trim())
      throw new Error("Task command must not be empty");
    const now = this.now();
    const id = this.ports.ids.next();
    const paths = this.ports.logs.paths?.(id) ?? {
      stdoutPath: "",
      stderrPath: "",
      logsPath: "",
    };
    const task: TaskRecord = {
      id,
      definitionId: request.definitionId,
      name: request.name,
      displayName: request.displayName,
      groupId: request.groupId,
      groupName: request.groupName,
      projectId: request.projectId,
      conversationId: request.conversationId,
      agentId: request.agentId,
      cwd,
      command: request.command,
      envInfo: request.env
        ? {
            keys: Object.keys(request.env).sort(),
            persisted: Boolean(this.ports.launchConfigs),
            redacted: true,
          }
        : undefined,
      status: "starting",
      readiness: {
        readyUrl: request.readyUrl,
        readyOnUrl: request.readyOnUrl,
        readyPattern: request.readyPattern,
        timeoutMs:
          request.readyUrl || request.readyOnUrl || request.readyPattern
            ? (request.readyTimeoutMs ?? (request.readyUrl ? 30_000 : 3_000))
            : undefined,
        outcome:
          request.readyUrl || request.readyOnUrl || request.readyPattern
            ? "pending"
            : "none",
      },
      ...paths,
      startedAt: now,
      updatedAt: now,
      timeoutMs: request.timeoutMs,
      origin: request.origin ?? { kind: "api" },
      visibility: request.visibility ?? "background",
      completion: request.completion,
      notifications: request.notifications,
      restartedFromTaskId: request.restartedFromTaskId,
      restartRootTaskId: request.restartRootTaskId ?? id,
      restartGeneration: request.restartGeneration ?? 0,
    };
    if (request.onOutput) this.startCallbacks.set(id, request.onOutput);
    await this.ports.launchConfigs?.save(id, request.env);
    try {
      await this.save(task);
    } catch (error) {
      await this.ports.launchConfigs?.remove(task).catch(() => undefined);
      throw error;
    }
    await this.publish("task.created", { task });
    try {
      const runtime = await this.ports.process.spawn(
        { ...request, taskId: id },
        {
          onOutput: (stream, text) =>
            this.processSupervisor.output(id, stream, text),
          onExit: (exit) => this.processSupervisor.exit(id, exit),
        },
      );
      return await this.transition(id, async (current) => {
        if (isTerminalTaskStatus(current.status)) return current;
        current.runtime = runtime;
        current.status = "running";
        current.updatedAt = this.now();
        await this.save(current);
        await this.publish("task.started", { task: current });
        if (current.readiness.outcome === "pending")
          this.processSupervisor.launchBackground(
            "readiness",
            id,
            this.processSupervisor.watchReadiness(id, request),
          );
        if (request.timeoutMs) {
          const elapsedMs = Math.max(
            0,
            Date.parse(this.now()) - Date.parse(current.startedAt),
          );
          this.processSupervisor.launchBackground(
            "runtime_timeout",
            id,
            this.processSupervisor.watchRuntimeTimeout(
              id,
              Math.max(0, request.timeoutMs - elapsedMs),
            ),
          );
        }
        return current;
      });
    } catch (error) {
      await this.transition(id, async (current) => {
        if (isTerminalTaskStatus(current.status)) return current;
        current.status = "failed";
        current.error = error instanceof Error ? error.message : String(error);
        current.finishedAt = this.now();
        current.updatedAt = current.finishedAt;
        await this.save(current);
        await this.publish("task.failed", { task: current });
        await this.safeNotify(current, "failed");
        this.startCallbacks.delete(id);
        return current;
      });
      throw error;
    }
  }

  async launchDefinition(
    request: TaskStartInput & {
      definitionId: string;
      definitionRunPolicy: "single" | "concurrent";
      definitionPort?: number;
      terminateListeners?: readonly TaskPortConflictListener[];
    },
  ): Promise<TaskDefinitionLaunchOutcome> {
    const guarded = request.definitionPort !== undefined;
    if (request.definitionRunPolicy === "concurrent" && !guarded) {
      return { task: await this.start(request), disposition: "started" };
    }
    const active = (await this.list()).find(
      (task) =>
        task.definitionId === request.definitionId &&
        ["starting", "running", "ready", "stopping", "recovered"].includes(
          task.status,
        ),
    );
    if (active) return { task: active, disposition: "focused_existing" };
    const pending = this.definitionLaunches.get(request.definitionId);
    if (pending) {
      const outcome = await pending;
      return outcome.disposition === "started"
        ? { task: outcome.task, disposition: "focused_existing" }
        : outcome;
    }
    const launch = (async (): Promise<TaskDefinitionLaunchOutcome> => {
      const listeners = await inspectDefinitionPort(
        this.ports.definitionPortGuard,
        request.definitionPort,
        request.terminateListeners,
      );
      return listeners.length > 0 && request.definitionPort !== undefined
        ? {
            disposition: "port_conflict",
            conflict: { port: request.definitionPort, listeners },
          }
        : { task: await this.start(request), disposition: "started" };
    })();
    this.definitionLaunches.set(request.definitionId, launch);
    try {
      return await launch;
    } finally {
      if (this.definitionLaunches.get(request.definitionId) === launch)
        this.definitionLaunches.delete(request.definitionId);
    }
  }

  get(id: string): Promise<TaskRecord | undefined> {
    return this.ports.repository.get(id);
  }

  async require(id: string): Promise<TaskRecord> {
    const task = await this.get(id);
    if (!task) throw new Error(`Unknown task: ${id}`);
    return task;
  }

  async list(
    filter: Partial<
      Pick<TaskRecord, "projectId" | "conversationId" | "agentId" | "groupId">
    > = {},
  ): Promise<TaskRecord[]> {
    await this.reconcileOrphans(true);
    const records = await this.ports.repository.list();
    return records
      .filter((record) =>
        Object.entries(filter).every(
          ([key, value]) =>
            value === undefined || record[key as keyof TaskRecord] === value,
        ),
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async logs(id: string, query: TaskLogQuery): Promise<TaskLogQueryResponse> {
    return this.ports.logs.query(await this.require(id), query);
  }

  async cancel(
    id: string,
    options: TaskCancelOptions = {},
  ): Promise<TaskRecord> {
    let requested = false;
    const initial = await this.transition(id, async (task) => {
      if (task.status === "recovery_unknown")
        throw new Error(
          "Task process identity is unverified; refusing to signal a possibly reused PID",
        );
      if (isTerminalTaskStatus(task.status) && task.status !== "orphaned") {
        return task;
      }
      const hardEscalation =
        task.status === "stopping" && options.signal === "SIGKILL";
      if (task.status === "stopping" && !hardEscalation) return task;
      requested = true;
      this.stopReasons.set(id, "cancelled");
      task.status = "stopping";
      task.updatedAt = this.now();
      await this.save(task);
      await this.publish("task.stop_requested", {
        task,
        signal: options.signal ?? "SIGTERM",
        reason: options.reason,
      });
      return task;
    });
    if (isTerminalTaskStatus(initial.status) || !requested) return initial;
    await this.ports.process.signal(initial, options);
    const timeoutMs = options.timeoutMs ?? this.ports.stopTimeoutMs ?? 5_000;
    let evidence = await this.processSupervisor.waitForExit(initial, timeoutMs);
    if (evidence === "timeout" && options.signal !== "SIGKILL") {
      await this.ports.process.signal(initial, {
        ...options,
        signal: "SIGKILL",
        reason: options.reason ?? "graceful stop timed out",
      });
      evidence = await this.processSupervisor.waitForExit(initial, timeoutMs);
    }
    if (typeof evidence === "object")
      return this.finishFromExit(id, evidence, "cancelled", options.reason);
    if (evidence === "exited")
      return this.finishFromExit(
        id,
        { exitedAt: this.now(), signal: options.signal },
        "cancelled",
        options.reason,
      );
    return (await this.get(id)) ?? initial;
  }

  async restart(
    id: string,
    options: { confirmUnverifiedReplacement?: boolean } = {},
  ): Promise<TaskRecord> {
    const previous = await this.require(id);
    if (
      previous.status === "recovery_unknown" &&
      !options.confirmUnverifiedReplacement
    )
      throw new Error(
        "Task process identity is unverified; confirm starting a replacement without stopping it",
      );
    if (previous.envInfo && !previous.envInfo.persisted)
      throw new Error(
        "Task launch environment was not persisted; restart is unavailable",
      );
    if (previous.envInfo?.persisted && !this.ports.launchConfigs)
      throw new Error("Persisted task launch environment is unavailable");
    const env = await this.ports.launchConfigs?.load(previous);
    if (
      !isTerminalTaskStatus(previous.status) &&
      previous.status !== "recovery_unknown"
    ) {
      const stopped = await this.cancel(id, { reason: "restart" });
      if (!isTerminalTaskStatus(stopped.status))
        throw new Error("Task is still running and cannot be restarted");
    }
    return this.start({
      definitionId: previous.definitionId,
      name: previous.name,
      displayName: previous.displayName,
      groupId: previous.groupId,
      groupName: previous.groupName,
      projectId: previous.projectId,
      conversationId: previous.conversationId,
      agentId: previous.agentId,
      cwd: previous.cwd,
      command: previous.command,
      env,
      timeoutMs: previous.timeoutMs,
      readyUrl: previous.readiness.readyUrl,
      readyOnUrl: previous.readiness.readyOnUrl,
      readyPattern: previous.readiness.readyPattern,
      readyTimeoutMs: previous.readiness.timeoutMs,
      origin: previous.origin,
      visibility: previous.visibility,
      completion: previous.completion,
      notifications: previous.notifications,
      restartedFromTaskId: previous.id,
      restartRootTaskId: previous.restartRootTaskId ?? previous.id,
      restartGeneration: (previous.restartGeneration ?? 0) + 1,
    });
  }

  async reconcileOrphans(onlyRecovered = false): Promise<TaskRecord[]> {
    const orphaned: TaskRecord[] = [];
    for (const task of await this.ports.repository.list()) {
      if (
        isTerminalTaskStatus(task.status) ||
        (onlyRecovered && task.status !== "recovered")
      )
        continue;
      const evidence = await this.ports.process.inspect(task);
      if (
        evidence === "running" ||
        (task.status === "recovered" &&
          (evidence === "unsupervised_running" ||
            evidence === "alive_verified"))
      )
        continue;
      const recovery =
        evidence === "unsupervised_running" || evidence === "alive_verified"
          ? {
              status: "recovered" as const,
              event: "task.recovered" as const,
              error:
                "Process recovered after supervision was interrupted. Live output is disconnected.",
            }
          : evidence === "exited" ||
              evidence === "exited_verified" ||
              evidence === "identity_mismatch"
            ? {
                status: "interrupted" as const,
                event: "task.interrupted" as const,
                error:
                  evidence === "identity_mismatch"
                    ? "Original process identity no longer matches; the PID was reused."
                    : "Process exited while supervision was unavailable.",
              }
            : {
                status: "recovery_unknown" as const,
                event: "task.recovery_unknown" as const,
                error: "Process identity could not be verified safely.",
              };
      const result = await this.transition(task.id, async (current) => {
        if (isTerminalTaskStatus(current.status)) return current;
        Object.assign(
          current,
          (await this.ports.capabilities?.prepareOrphan?.(current)) ?? {},
        );
        current.status = recovery.status;
        current.error = recovery.error;
        current.finishedAt =
          recovery.status === "interrupted" ? this.now() : undefined;
        current.updatedAt = this.now();
        await this.save(current);
        await this.publish(recovery.event, { task: current });
        return current;
      });
      if (["recovered", "recovery_unknown"].includes(result.status))
        orphaned.push(result);
    }
    return orphaned;
  }

  async inspectPorts(
    id: string,
  ): Promise<TaskCapabilityResult<readonly number[]>> {
    const task = await this.require(id);
    return this.ports.process.inspectPorts?.(task) ?? "unavailable";
  }

  async releasePorts(
    id: string,
    ports: readonly number[],
  ): Promise<TaskCapabilityResult<readonly number[]>> {
    const task = await this.require(id);
    return this.ports.process.releasePorts?.(task, ports) ?? "unavailable";
  }

  async backgroundActiveTask(
    id: string,
    patch: Pick<TaskRecord, "visibility" | "completion" | "notifications">,
  ): Promise<TaskRecord> {
    return this.transition(id, async (task) => {
      if (isTerminalTaskStatus(task.status)) return task;
      Object.assign(task, patch, { updatedAt: this.now() });
      await this.save(task);
      return task;
    });
  }

  async promoteForeground(
    id: string,
  ): Promise<TaskCapabilityResult<TaskRecord>> {
    const task = await this.require(id);
    return this.ports.capabilities?.promoteForeground?.(task) ?? "unavailable";
  }

  async prune(): Promise<string[]> {
    const removed: string[] = [];
    for (const task of await this.ports.repository.list()) {
      if (!isTerminalTaskStatus(task.status)) continue;
      await this.delete(task.id);
      removed.push(task.id);
    }
    return removed;
  }

  async delete(id: string): Promise<void> {
    await this.serializeTask(id, async () => {
      const task = await this.require(id);
      if (!isTerminalTaskStatus(task.status))
        throw new Error("Active tasks must be cancelled before deletion");
      await this.ports.repository.remove(id);
      await this.ports.logs.remove(task);
      await this.ports.launchConfigs?.remove(task);
      this.startCallbacks.delete(id);
      await this.ports.capabilities?.afterRemoved?.(task);
      await this.publish("task.removed", { taskId: id });
    });
  }

  pendingTerminalFailureIds(): readonly string[] {
    return [...this.terminalFailures.keys()];
  }

  async retryTerminalFailure(id: string): Promise<TaskRecord> {
    const failure = this.terminalFailures.get(id);
    if (!failure)
      throw new Error(`No pending terminal failure for task: ${id}`);
    const current = await this.require(id);
    const task = isTerminalTaskStatus(current.status)
      ? current
      : await this.finishFromExit(id, failure.exit);
    if (isTerminalTaskStatus(current.status))
      await this.publish(`task.${current.status}`, { task: current });
    this.terminalFailures.delete(id);
    return task;
  }

  private async finishFromExit(
    id: string,
    exit: TaskProcessExit,
    forcedStatus?: "cancelled" | "timed_out",
    reason?: string,
  ): Promise<TaskRecord> {
    return this.transition(id, async (task) => {
      if (isTerminalTaskStatus(task.status)) return task;
      const status =
        forcedStatus ??
        this.stopReasons.get(id) ??
        (exit.exitCode === 0 ? "completed" : "failed");
      task.exitCode = exit.exitCode ?? null;
      task.signal = exit.signal ?? null;
      task.finishedAt = exit.exitedAt;
      task.updatedAt = exit.exitedAt;
      task.status = status;
      task.outputRetention = this.ports.logs.retention?.(task);
      if (reason) task.error = reason;
      else if (status === "timed_out")
        task.error = "Task exceeded maximum runtime.";
      await this.save(task);
      await this.publish(`task.${status}`, { task });
      this.stopReasons.delete(id);
      this.startCallbacks.delete(id);
      if (status === "completed") {
        await this.safeNotify(task, "completed");
        await this.ports.capabilities
          ?.injectCompletion?.(task)
          .catch(() => undefined);
      } else if (status === "failed" || status === "timed_out") {
        await this.safeNotify(task, "failed");
      }
      return task;
    });
  }

  private transition(
    id: string,
    change: (task: TaskRecord) => Promise<TaskRecord>,
  ): Promise<TaskRecord> {
    return this.serializeTask(id, async () =>
      change(structuredClone(await this.require(id))),
    );
  }

  private transitionIfPresent(
    id: string,
    change: (task: TaskRecord) => Promise<TaskRecord>,
  ): Promise<TaskRecord | undefined> {
    return this.serializeTask(id, async () => {
      const task = await this.get(id);
      return task ? change(structuredClone(task)) : undefined;
    });
  }

  private async serializeTask<T>(
    id: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = (this.transitions.get(id) ?? Promise.resolve()).catch(
      () => undefined,
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const queued = previous.then(() => gate);
    this.transitions.set(id, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.transitions.get(id) === queued) this.transitions.delete(id);
    }
  }

  private async save(task: TaskRecord): Promise<void> {
    await this.ports.repository.save(task);
    await this.ports.capabilities?.afterSaved?.(task);
  }

  private async safeNotify(
    task: TaskRecord,
    event: "ready" | "completed" | "failed",
  ): Promise<void> {
    await this.ports.notifications?.notify(task, event).catch(() => undefined);
  }

  private publish(
    type: string,
    data: unknown,
    delivery: "sequenced" | "ephemeral" = "sequenced",
  ): Promise<void> {
    return this.ports.events.publish({
      type,
      data,
      delivery,
      occurredAt: this.now(),
    });
  }

  private reportFailure(kind: string, taskId: string, error: unknown): void {
    try {
      this.ports.diagnostics?.error("Task lifecycle background failure", {
        kind,
        taskId,
        error: boundedErrorMessage(error),
      });
    } catch {
      // Diagnostics must never create a second unhandled lifecycle failure.
    }
  }

  private now(): string {
    return this.ports.clock.now().toISOString();
  }
}

function boundedErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    4_096,
  );
}

export function resolveTaskWorkingDirectory(input: string): string {
  const flavor =
    /^[A-Za-z]:[\\/]/.test(input) || input.startsWith("\\")
      ? path.win32
      : path.posix;
  if (!flavor.isAbsolute(input)) {
    throw new Error("Task working directory must be an absolute path");
  }
  return flavor.resolve(input);
}
