/* eslint-disable max-lines -- task lifecycle state machine remains centralized pending the planned port extraction. */
import path from "node:path";
import type {
  StartTaskRequest,
  TaskLogQuery,
  TaskLogQueryResponse,
  TaskRecord,
} from "@nervekit/contracts";
import { splitLiveOutputChunks } from "@nervekit/tools";
import type {
  ClockPort,
  DiagnosticPort,
  DomainEventPublisherPort,
  IdPort,
} from "./index.js";

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
    text: string,
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
    text: string,
  ): Promise<void>;
  remove(task: TaskRecord): Promise<void>;
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
  readonly workspaceRoot: string;
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
  readonly onOutput?: (update: {
    kind: "output";
    stream: "stdout" | "stderr" | "combined";
    chunk: string;
  }) => void | Promise<void>;
};

const terminalStatuses = new Set<TaskRecord["status"]>([
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "orphaned",
  "interrupted",
]);

export function isTerminalTaskStatus(status: TaskRecord["status"]): boolean {
  return terminalStatuses.has(status);
}

export class TaskService {
  private readonly definitionLaunches = new Map<string, Promise<TaskRecord>>();
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

  constructor(private readonly ports: TaskServicePorts) {}

  async start(request: TaskStartInput): Promise<TaskRecord> {
    assertWorkspacePath(request.cwd, this.ports.workspaceRoot);
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
      workerId: request.workerId,
      projectId: request.projectId,
      conversationId: request.conversationId,
      agentId: request.agentId,
      cwd: resolveWorkspacePath(request.cwd, this.ports.workspaceRoot),
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
          onOutput: (stream, text) => this.recordOutput(id, stream, text),
          onExit: (exit) => this.recordExit(id, exit),
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
          this.launchBackground(
            "readiness",
            id,
            this.watchReadiness(id, request),
          );
        if (request.timeoutMs)
          this.launchBackground(
            "runtime_timeout",
            id,
            this.watchRuntimeTimeout(id, request.timeoutMs),
          );
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
    },
  ): Promise<{
    task: TaskRecord;
    disposition: "started" | "focused_existing";
  }> {
    if (request.definitionRunPolicy === "concurrent") {
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
    if (pending)
      return { task: await pending, disposition: "focused_existing" };
    const launch = this.start(request);
    this.definitionLaunches.set(request.definitionId, launch);
    try {
      return { task: await launch, disposition: "started" };
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
      Pick<
        TaskRecord,
        "projectId" | "conversationId" | "agentId" | "workerId" | "groupId"
      >
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
    let evidence = await this.waitForExit(initial, timeoutMs);
    if (evidence === "timeout" && options.signal !== "SIGKILL") {
      await this.ports.process.signal(initial, {
        ...options,
        signal: "SIGKILL",
        reason: options.reason ?? "graceful stop timed out",
      });
      evidence = await this.waitForExit(initial, timeoutMs);
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
      workerId: previous.workerId,
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
    const task = await this.require(id);
    if (!isTerminalTaskStatus(task.status))
      throw new Error("Active tasks must be cancelled before deletion");
    await this.ports.logs.remove(task);
    await this.ports.launchConfigs?.remove(task);
    await this.ports.repository.remove(id);
    this.startCallbacks.delete(id);
    await this.ports.capabilities?.afterRemoved?.(task);
    await this.publish("task.removed", { taskId: id });
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

  private launchBackground(
    kind: "readiness" | "runtime_timeout",
    id: string,
    operation: Promise<void>,
  ): void {
    void operation
      .catch((error) => this.handleBackgroundFailure(kind, id, error))
      .catch((error) =>
        this.reportFailure(`${kind}_failure_handler`, id, error),
      );
  }

  private async handleBackgroundFailure(
    kind: "readiness" | "runtime_timeout",
    id: string,
    error: unknown,
  ): Promise<void> {
    this.reportFailure(kind, id, error);
    await this.transition(id, async (task) => {
      if (isTerminalTaskStatus(task.status)) return task;
      if (kind === "readiness" && task.readiness.outcome === "pending") {
        task.readiness.outcome = "unavailable";
        task.updatedAt = this.now();
        await this.save(task);
        await this.publish("task.readiness_failed", {
          task,
          reason: boundedErrorMessage(error),
        });
      } else if (kind === "runtime_timeout") {
        task.error = `Runtime timeout watcher failed: ${boundedErrorMessage(error)}`;
        task.updatedAt = this.now();
        await this.save(task);
      }
      return task;
    });
  }

  private async watchReadiness(
    id: string,
    request: StartTaskRequest,
  ): Promise<void> {
    const task = await this.require(id);
    const readiness = this.ports.readiness
      ? await this.ports.readiness.wait(task, request)
      : "unavailable";
    const outcome =
      typeof readiness === "object" ? readiness.outcome : readiness;
    await this.transition(id, async (current) => {
      if (isTerminalTaskStatus(current.status) || current.status === "stopping")
        return current;
      current.readiness.outcome = outcome;
      if (typeof readiness === "object" && readiness.matched)
        current.readiness.matched = readiness.matched;
      current.updatedAt = this.now();
      if (outcome === "ready") {
        current.status = "ready";
        current.readiness.readyAt = current.updatedAt;
        await this.save(current);
        await this.publish("task.ready", { task: current });
        await this.safeNotify(current, "ready");
      } else {
        await this.save(current);
        if (outcome === "timeout")
          await this.publish("task.readiness_failed", { task: current });
      }
      return current;
    });
  }

  private async recordOutput(
    id: string,
    stream: "stdout" | "stderr",
    text: string,
  ): Promise<void> {
    const task = await this.get(id);
    if (!task) return;
    await this.ports.logs.append?.(task, stream, text);
    for (const chunk of splitLiveOutputChunks(text)) {
      try {
        await this.publish(
          "task.output",
          { taskId: id, stream, text: chunk },
          "ephemeral",
        );
      } catch (error) {
        this.reportFailure("output_event", id, error);
      }
      // Live observers are projections. Durable truth remains in the task log,
      // so observer failures must not alter process supervision or terminal state.
      try {
        await this.startCallbacks.get(id)?.({
          kind: "output",
          stream,
          chunk,
        });
      } catch (error) {
        this.reportFailure("output_observer", id, error);
      }
    }
  }

  private async recordExit(id: string, exit: TaskProcessExit): Promise<void> {
    try {
      await this.finishFromExit(id, exit);
      this.terminalFailures.delete(id);
    } catch (error) {
      this.terminalFailures.set(id, { exit, error });
      this.reportFailure("terminal_persistence", id, error);
    }
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

  private async watchRuntimeTimeout(
    id: string,
    timeoutMs: number,
  ): Promise<void> {
    await (this.ports.timers?.sleep(timeoutMs) ??
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)));
    const task = await this.transition(id, async (current) => {
      if (isTerminalTaskStatus(current.status) || current.status === "stopping")
        return current;
      this.stopReasons.set(id, "timed_out");
      current.status = "stopping";
      current.error = "Task exceeded maximum runtime.";
      current.updatedAt = this.now();
      await this.save(current);
      await this.publish("task.stop_requested", {
        task: current,
        signal: "SIGTERM",
        reason: "runtime_timeout",
      });
      return current;
    });
    if (
      isTerminalTaskStatus(task.status) ||
      this.stopReasons.get(id) !== "timed_out"
    )
      return;
    await this.ports.process.signal(task, {
      signal: "SIGTERM",
      timeoutMs: this.ports.stopTimeoutMs ?? 5_000,
      reason: "runtime_timeout",
    });
    const stopTimeoutMs = this.ports.stopTimeoutMs ?? 5_000;
    let exit = await this.waitForExit(task, stopTimeoutMs);
    if (exit === "timeout") {
      await this.ports.process.signal(task, {
        signal: "SIGKILL",
        timeoutMs: stopTimeoutMs,
        reason: "runtime_timeout_escalation",
      });
      exit = await this.waitForExit(task, stopTimeoutMs);
    }
    if (typeof exit === "object")
      await this.finishFromExit(id, exit, "timed_out");
    else if (exit === "exited")
      await this.finishFromExit(id, { exitedAt: this.now() }, "timed_out");
  }

  private async waitForExit(
    task: TaskRecord,
    timeoutMs: number,
  ): Promise<
    TaskProcessExit | TaskProcessEvidence | "timeout" | "unavailable"
  > {
    if (this.ports.process.waitForExit)
      return this.ports.process.waitForExit(task, timeoutMs);
    return this.ports.process.inspect(task);
  }

  private async transition(
    id: string,
    change: (task: TaskRecord) => Promise<TaskRecord>,
  ): Promise<TaskRecord> {
    const previous = (this.transitions.get(id) ?? Promise.resolve()).catch(
      () => undefined,
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const queued = previous.then(() => gate);
    this.transitions.set(id, queued);
    await previous;
    try {
      return await change(structuredClone(await this.require(id)));
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

export function assertWorkspacePath(
  input: string,
  workspaceRoot: string,
): void {
  resolveWorkspacePath(input, workspaceRoot);
}

function resolveWorkspacePath(input: string, workspaceRoot: string): string {
  const flavor = /^[A-Za-z]:[\\/]/.test(workspaceRoot) ? path.win32 : path;
  const root = flavor.resolve(workspaceRoot);
  const target = flavor.resolve(input);
  const relative = flavor.relative(root, target);
  if (
    relative === "" ||
    (!relative.startsWith("..") && !flavor.isAbsolute(relative))
  )
    return target;
  throw new Error("Task working directory must be inside the workspace root");
}
