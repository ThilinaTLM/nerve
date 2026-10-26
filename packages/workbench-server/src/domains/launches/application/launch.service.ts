import {
  type PreparedShellProcess,
  stopProcessTree,
} from "../../../infrastructure/process-host/shell-process.js";
import type { WorkbenchLaunchResources } from "../adapters/workbench-launch-adapters.js";
import { isActiveLaunchStatus } from "../model/launch-status.js";
import type {
  StartLaunchRequest,
  LaunchPortConflictListener,
  LaunchLogQuery,
  LaunchLogQueryResponse,
  LaunchOutputRetention,
  LaunchRecord,
} from "@nervekit/contracts/launches";
import type { ToolExecutionOutputUpdate } from "@nervekit/tools/execution";
import type { ClockPort } from "../../../core/ports/clock.js";
import type { DiagnosticPort } from "../../../core/ports/diagnostics.js";
import type { DomainEventPublisherPort } from "../../../core/ports/domain-events.js";
import type { IdPort } from "../../../core/ports/ids.js";
import {
  inspectDefinitionPort,
  type LaunchDefinitionLaunchOutcome,
  type LaunchDefinitionPortGuard,
} from "../model/launch-definition-launch.js";
import { LaunchProcessSupervisor } from "./launch-process-supervisor.js";
import { isTerminalLaunchStatus } from "../model/launch-status.js";
import { resolveLaunchWorkingDirectory } from "../model/launch-working-directory.js";

export { isTerminalLaunchStatus } from "../model/launch-status.js";

export type LaunchProcessEvidence =
  | "running"
  | "unsupervised_running"
  | "alive_verified"
  | "exited"
  | "exited_verified"
  | "identity_mismatch"
  | "unknown";
export type LaunchCapabilityResult<T> = T | "unavailable";

export interface LaunchRepositoryPort {
  get(id: string): Promise<LaunchRecord | undefined>;
  list(): Promise<LaunchRecord[]>;
  save(launch: LaunchRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface LaunchProcessExit {
  readonly exitCode?: number;
  readonly signal?: string;
  readonly exitedAt: string;
}

export interface LaunchProcessCallbacks {
  readonly onOutput?: (
    stream: "stdout" | "stderr",
    chunk: Buffer | string,
  ) => void | Promise<void>;
  readonly onExit?: (exit: LaunchProcessExit) => void | Promise<void>;
}

export interface LaunchProcessPort {
  spawn(
    input: LaunchStartInput & { launchId: string },
    callbacks?: LaunchProcessCallbacks,
  ): Promise<LaunchRecord["runtime"]>;
  signal(launch: LaunchRecord, options: LaunchCancelOptions): Promise<void>;
  inspect(launch: LaunchRecord): Promise<LaunchProcessEvidence>;
  waitForExit?(
    launch: LaunchRecord,
    timeoutMs: number,
  ): Promise<LaunchCapabilityResult<LaunchProcessExit | "timeout">>;
}

export interface LaunchLogPort {
  query(
    launch: LaunchRecord,
    query: LaunchLogQuery,
  ): Promise<LaunchLogQueryResponse>;
  append?(
    launch: LaunchRecord,
    stream: "stdout" | "stderr",
    chunk: Buffer | string,
  ): Promise<void>;
  remove(launch: LaunchRecord): Promise<void>;
  retention?(launch: LaunchRecord): LaunchOutputRetention | undefined;
  paths?(launchId: string): {
    stdoutPath: string;
    stderrPath: string;
    logsPath: string;
    combinedPath?: string;
  };
}

export type LaunchReadinessOutcome =
  | "ready"
  | "timeout"
  | "exited"
  | "unavailable"
  | { outcome: "ready"; matched?: string };

export interface LaunchReadinessPort {
  wait(
    launch: LaunchRecord,
    request: StartLaunchRequest,
  ): Promise<LaunchReadinessOutcome>;
}

export interface LaunchCancelOptions {
  readonly signal?: "SIGTERM" | "SIGINT" | "SIGKILL";
  readonly timeoutMs?: number;
  readonly reason?: string;
}

export interface LaunchEnvPort {
  readonly persisted?: boolean;
  save(
    launchId: string,
    env: Record<string, string> | undefined,
  ): Promise<void>;
  load(launch: LaunchRecord): Promise<Record<string, string> | undefined>;
  remove(launch: LaunchRecord): Promise<void>;
}

export interface LaunchTimerPort {
  sleep(ms: number): Promise<void>;
}

export interface LaunchServicePorts {
  readonly repository: LaunchRepositoryPort;
  readonly process: LaunchProcessPort;
  readonly logs: LaunchLogPort;
  readonly readiness?: LaunchReadinessPort;
  readonly events: DomainEventPublisherPort;
  readonly clock: ClockPort;
  readonly ids: IdPort;
  readonly env?: LaunchEnvPort;
  readonly timers?: LaunchTimerPort;
  readonly diagnostics?: DiagnosticPort;
  readonly definitionPortGuard?: LaunchDefinitionPortGuard;
  readonly stopTimeoutMs?: number;
}

export type LaunchStartInput = StartLaunchRequest & {
  /** Transient admitted process target; never persisted in launch/env records. */
  readonly preparedShell?: PreparedShellProcess;
  readonly visibility?: LaunchRecord["visibility"];
  readonly restartedFromLaunchId?: string;
  readonly restartRootLaunchId?: string;
  readonly restartGeneration?: number;
  readonly onOutput?: (
    update: ToolExecutionOutputUpdate,
  ) => void | Promise<void>;
};

export type PreparedLaunchStartInput = LaunchStartInput & {
  preparedShell: PreparedShellProcess;
};

export class LaunchService {
  private readonly definitionLaunches = new Map<
    string,
    Promise<LaunchDefinitionLaunchOutcome>
  >();
  private readonly stopReasons = new Map<string, "cancelled" | "timed_out">();
  private readonly startCallbacks = new Map<
    string,
    NonNullable<LaunchStartInput["onOutput"]>
  >();
  private readonly transitions = new Map<string, Promise<unknown>>();
  private readonly terminalFailures = new Map<
    string,
    { readonly exit: LaunchProcessExit; readonly error: unknown }
  >();
  private readonly processSupervisor: LaunchProcessSupervisor;

  private readonly ports: LaunchServicePorts;
  private closing = false;
  private readonly portPolls = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly resources: WorkbenchLaunchResources) {
    const ports = resources.ports;
    this.ports = ports;
    this.processSupervisor = new LaunchProcessSupervisor({
      process: ports.process,
      logs: ports.logs,
      readiness: ports.readiness,
      timers: ports.timers,
      stopTimeoutMs: ports.stopTimeoutMs ?? 5_000,
      get: (id) => this.get(id),
      transitionIfPresent: (id, change) => this.transitionIfPresent(id, change),
      save: (launch) => this.save(launch),
      publish: (type, data, delivery) => this.publish(type, data, delivery),
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

  async start(request: LaunchStartInput): Promise<LaunchRecord> {
    if (this.closing) throw new Error("Launch service is shutting down.");
    request = {
      ...request,
      visibility: "background",
      onOutput: undefined,
      env: request.env && { ...request.env },
      preparedShell:
        request.preparedShell && structuredClone(request.preparedShell),
    };
    const cwd = resolveLaunchWorkingDirectory(request.cwd);
    if (
      request.preparedShell &&
      (request.preparedShell.command !== request.command ||
        request.preparedShell.cwd !== cwd)
    )
      throw new Error("Prepared launch target does not match execution");
    request = { ...request, cwd };
    if (!request.command.trim())
      throw new Error("Launch command must not be empty");
    const now = this.now();
    const id = this.ports.ids.next();
    const paths = this.ports.logs.paths?.(id) ?? {
      stdoutPath: "",
      stderrPath: "",
      logsPath: "",
    };
    const launch: LaunchRecord = {
      id,
      definitionId: request.definitionId,
      name: request.name,
      displayName: request.displayName,
      groupId: request.groupId,
      groupName: request.groupName,
      projectId: request.projectId,
      cwd,
      command: request.command,
      envInfo: request.env
        ? {
            keys: Object.keys(request.env).sort(),
            persisted:
              Boolean(this.ports.env) && this.ports.env?.persisted !== false,
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
      visibility: request.visibility ?? "background",
      restartedFromLaunchId: request.restartedFromLaunchId,
      restartRootLaunchId: request.restartRootLaunchId ?? id,
      restartGeneration: request.restartGeneration ?? 0,
    };
    if (request.onOutput) this.startCallbacks.set(id, request.onOutput);
    await this.ports.env?.save(id, request.env);
    try {
      await this.save(launch);
    } catch (error) {
      await this.ports.env?.remove(launch).catch(() => undefined);
      throw error;
    }
    await this.publish("launch.created", { launch });
    try {
      const runtime = await this.ports.process.spawn(
        { ...request, launchId: id },
        {
          onOutput: (stream, text) =>
            this.processSupervisor.output(id, stream, text),
          onExit: (exit) => this.processSupervisor.exit(id, exit),
        },
      );
      const started = await this.transition(id, async (current) => {
        if (isTerminalLaunchStatus(current.status)) return current;
        current.runtime = runtime;
        current.status = "running";
        current.updatedAt = this.now();
        await this.save(current);
        await this.publish("launch.started", { launch: current });
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
      this.schedulePortPoll(started.id);
      return started;
    } catch (error) {
      await this.transition(id, async (current) => {
        if (isTerminalLaunchStatus(current.status)) return current;
        current.status = "failed";
        current.error = error instanceof Error ? error.message : String(error);
        current.finishedAt = this.now();
        current.updatedAt = current.finishedAt;
        await this.save(current);
        await this.publish("launch.failed", { launch: current });
        this.startCallbacks.delete(id);
        return current;
      });
      throw error;
    }
  }

  async launchDefinition(
    request: LaunchStartInput & {
      definitionId: string;
      projectId: string;
      definitionRunPolicy: "single" | "concurrent";
      definitionPort?: number;
      terminateListeners?: readonly LaunchPortConflictListener[];
    },
  ): Promise<LaunchDefinitionLaunchOutcome> {
    const guarded = request.definitionPort !== undefined;
    if (request.definitionRunPolicy === "concurrent" && !guarded) {
      return { launch: await this.start(request), disposition: "started" };
    }
    const active = (await this.list({ projectId: request.projectId })).find(
      (launch) =>
        launch.definitionId === request.definitionId &&
        ["starting", "running", "ready", "stopping"].includes(launch.status),
    );
    if (active) return { launch: active, disposition: "focused_existing" };
    const definitionKey = JSON.stringify([
      request.projectId,
      request.definitionId,
    ]);
    const pending = this.definitionLaunches.get(definitionKey);
    if (pending) {
      const outcome = await pending;
      return outcome.disposition === "started"
        ? { launch: outcome.launch, disposition: "focused_existing" }
        : outcome;
    }
    const launch = (async (): Promise<LaunchDefinitionLaunchOutcome> => {
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
        : { launch: await this.start(request), disposition: "started" };
    })();
    this.definitionLaunches.set(definitionKey, launch);
    try {
      return await launch;
    } finally {
      if (this.definitionLaunches.get(definitionKey) === launch)
        this.definitionLaunches.delete(definitionKey);
    }
  }

  get(id: string): Promise<LaunchRecord | undefined> {
    return this.ports.repository.get(id);
  }

  async require(id: string): Promise<LaunchRecord> {
    const launch = await this.get(id);
    if (!launch) throw new Error(`Unknown launch: ${id}`);
    return launch;
  }

  async list(
    filter: Partial<Pick<LaunchRecord, "projectId" | "groupId">> = {},
  ): Promise<LaunchRecord[]> {
    const records = await this.ports.repository.list();
    return records
      .filter((record) =>
        Object.entries(filter).every(
          ([key, value]) =>
            value === undefined || record[key as keyof LaunchRecord] === value,
        ),
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async logs(
    id: string,
    query: LaunchLogQuery,
  ): Promise<LaunchLogQueryResponse> {
    return this.ports.logs.query(await this.require(id), query);
  }

  async cancel(
    id: string,
    options: LaunchCancelOptions = {},
  ): Promise<LaunchRecord> {
    let requested = false;
    const initial = await this.transition(id, async (launch) => {
      if (isTerminalLaunchStatus(launch.status)) {
        return launch;
      }
      const hardEscalation =
        launch.status === "stopping" && options.signal === "SIGKILL";
      if (launch.status === "stopping" && !hardEscalation) return launch;
      requested = true;
      this.stopReasons.set(id, "cancelled");
      launch.status = "stopping";
      launch.updatedAt = this.now();
      await this.save(launch);
      await this.publish("launch.stop_requested", {
        launch,
        signal: options.signal ?? "SIGTERM",
        reason: options.reason,
      });
      return launch;
    });
    if (isTerminalLaunchStatus(initial.status) || !requested) return initial;
    const timeoutMs = options.timeoutMs ?? this.ports.stopTimeoutMs ?? 5_000;
    const evidence = await stopProcessTree({
      signal: options.signal,
      signalProcess: (signal, escalated) =>
        this.ports.process.signal(
          initial,
          escalated
            ? {
                ...options,
                signal,
                reason: options.reason ?? "graceful stop timed out",
              }
            : options,
        ),
      waitForExit: () => this.processSupervisor.waitForExit(initial, timeoutMs),
    });
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

  async prepareRestart(id: string): Promise<LaunchStartInput> {
    const previous = structuredClone(await this.require(id));
    if (previous.envInfo && !previous.envInfo.persisted)
      throw new Error(
        "Launch environment was not persisted; restart is unavailable",
      );
    if (previous.envInfo?.persisted && !this.ports.env)
      throw new Error("Persisted launch environment is unavailable");
    const loadedEnv = await this.ports.env?.load(previous);
    if (previous.envInfo?.persisted && loadedEnv === undefined)
      throw new Error("Persisted launch environment is unavailable");
    const env = loadedEnv && { ...loadedEnv };
    return {
      definitionId: previous.definitionId,
      name: previous.name,
      displayName: previous.displayName,
      groupId: previous.groupId,
      groupName: previous.groupName,
      projectId: previous.projectId,
      cwd: previous.cwd,
      command: previous.command,
      env,
      timeoutMs: previous.timeoutMs,
      readyUrl: previous.readiness.readyUrl,
      readyOnUrl: previous.readiness.readyOnUrl,
      readyPattern: previous.readiness.readyPattern,
      readyTimeoutMs: previous.readiness.timeoutMs,
      visibility: previous.visibility,
      restartedFromLaunchId: previous.id,
      restartRootLaunchId: previous.restartRootLaunchId ?? previous.id,
      restartGeneration: (previous.restartGeneration ?? 0) + 1,
    };
  }

  async restart(id: string): Promise<LaunchRecord> {
    return this.restartWithInput(id, await this.prepareRestart(id));
  }

  async restartPrepared(
    id: string,
    request: PreparedLaunchStartInput,
  ): Promise<LaunchRecord> {
    if (request.restartedFromLaunchId !== id)
      throw new Error("Prepared restart source does not match execution");
    if (
      request.preparedShell.command !== request.command ||
      request.preparedShell.cwd !== resolveLaunchWorkingDirectory(request.cwd)
    )
      throw new Error("Prepared launch target does not match execution");
    // Capture before cancellation/publication callbacks; never reload env or target at dispatch.
    return this.restartWithInput(id, {
      ...request,
      env: request.env && { ...request.env },
      preparedShell: structuredClone(request.preparedShell),
    });
  }

  private async restartWithInput(
    id: string,
    request: LaunchStartInput,
  ): Promise<LaunchRecord> {
    const previous = await this.require(id);
    if (!isTerminalLaunchStatus(previous.status)) {
      const stopped = await this.cancel(id, { reason: "restart" });
      if (!isTerminalLaunchStatus(stopped.status))
        throw new Error("Launch is still running and cannot be restarted");
    }
    return this.start(request);
  }

  async prune(): Promise<string[]> {
    const removed: string[] = [];
    for (const launch of await this.ports.repository.list()) {
      if (!isTerminalLaunchStatus(launch.status)) continue;
      await this.delete(launch.id);
      removed.push(launch.id);
    }
    return removed;
  }

  async delete(id: string): Promise<void> {
    await this.serializeLaunch(id, async () => {
      const launch = await this.require(id);
      if (!isTerminalLaunchStatus(launch.status))
        throw new Error("Active launches must be cancelled before deletion");
      await this.ports.repository.remove(id);
      await this.ports.logs.remove(launch);
      await this.ports.env?.remove(launch);
      this.startCallbacks.delete(id);
      await this.publish("launch.removed", { launchId: id });
    });
    const timer = this.portPolls.get(id);
    if (timer) clearTimeout(timer);
    this.portPolls.delete(id);
  }

  pendingTerminalFailureIds(): readonly string[] {
    return [...this.terminalFailures.keys()];
  }

  async retryTerminalFailure(id: string): Promise<LaunchRecord> {
    const failure = this.terminalFailures.get(id);
    if (!failure)
      throw new Error(`No pending terminal failure for launch: ${id}`);
    const current = await this.require(id);
    const launch = isTerminalLaunchStatus(current.status)
      ? current
      : await this.finishFromExit(id, failure.exit);
    if (isTerminalLaunchStatus(current.status))
      await this.publish(`launch.${current.status}`, { launch: current });
    this.terminalFailures.delete(id);
    return launch;
  }

  private async finishFromExit(
    id: string,
    exit: LaunchProcessExit,
    forcedStatus?: "cancelled" | "timed_out",
    reason?: string,
  ): Promise<LaunchRecord> {
    return this.transition(id, async (launch) => {
      if (isTerminalLaunchStatus(launch.status)) return launch;
      const status =
        forcedStatus ??
        this.stopReasons.get(id) ??
        (exit.exitCode === 0 ? "completed" : "failed");
      launch.exitCode = exit.exitCode ?? null;
      launch.signal = exit.signal ?? null;
      launch.finishedAt = exit.exitedAt;
      launch.updatedAt = exit.exitedAt;
      launch.status = status;
      launch.outputRetention = this.ports.logs.retention?.(launch);
      if (reason) launch.error = reason;
      else if (status === "timed_out")
        launch.error = "Launch exceeded maximum runtime.";
      await this.save(launch);
      await this.publish(`launch.${status}`, { launch });
      this.stopReasons.delete(id);
      this.startCallbacks.delete(id);
      return launch;
    });
  }

  private transition(
    id: string,
    change: (launch: LaunchRecord) => Promise<LaunchRecord>,
  ): Promise<LaunchRecord> {
    return this.serializeLaunch(id, async () =>
      change(structuredClone(await this.require(id))),
    );
  }

  private transitionIfPresent(
    id: string,
    change: (launch: LaunchRecord) => Promise<LaunchRecord>,
  ): Promise<LaunchRecord | undefined> {
    return this.serializeLaunch(id, async () => {
      const launch = await this.get(id);
      return launch ? change(structuredClone(launch)) : undefined;
    });
  }

  private async serializeLaunch<T>(
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

  private async save(launch: LaunchRecord): Promise<void> {
    await this.ports.repository.save(launch);
  }

  private publish(
    type: string,
    data: unknown,
    delivery: "sequenced" | "ephemeral" = "ephemeral",
  ): Promise<void> {
    return this.ports.events.publish({
      type,
      data,
      delivery,
      occurredAt: this.now(),
    });
  }

  private reportFailure(kind: string, launchId: string, error: unknown): void {
    try {
      this.ports.diagnostics?.error("Launch lifecycle background failure", {
        kind,
        launchId,
        error: boundedErrorMessage(error),
      });
    } catch {
      // Diagnostics must never create a second unhandled lifecycle failure.
    }
  }

  private now(): string {
    return this.ports.clock.now().toISOString();
  }
  listLaunches(): LaunchRecord[] {
    return [...this.resources.launches.values()].sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    );
  }

  async associateDefinition(id: string, definitionId: string): Promise<void> {
    const source = await this.require(id);
    const root = source.restartRootLaunchId ?? source.id;
    for (const launch of this.listLaunches()) {
      if ((launch.restartRootLaunchId ?? launch.id) !== root) continue;
      const updated = await this.updateLaunch(launch.id, { definitionId });
      await this.publish("launch.updated", { launch: updated });
    }
  }

  queryLogs(id: string, query: LaunchLogQuery = {}) {
    return this.logs(id, query);
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    for (const timer of this.portPolls.values()) clearTimeout(timer);
    this.portPolls.clear();
    await Promise.allSettled(
      this.listLaunches()
        .filter((launch) => isActiveLaunchStatus(launch.status))
        .map((launch) =>
          this.cancel(launch.id, {
            signal: "SIGKILL",
            timeoutMs: 100,
            reason: "daemon_shutdown",
          }),
        ),
    );
  }

  private async updateLaunch(
    id: string,
    patch: Partial<LaunchRecord>,
  ): Promise<LaunchRecord> {
    const current = this.resources.launches.get(id);
    if (!current) throw new Error("Launch not found.");
    Object.assign(current, patch, { updatedAt: new Date().toISOString() });
    await this.resources.ports.repository.save(current);
    return current;
  }

  private schedulePortPoll(id: string): void {
    if (this.closing) return;
    const timer = setTimeout(() => {
      this.portPolls.delete(id);
      void this.refreshPorts(id)
        .catch(() => undefined)
        .finally(() => {
          const launch = this.resources.launches.get(id);
          if (launch && isActiveLaunchStatus(launch.status))
            this.schedulePortPoll(id);
        });
    }, 1_000);
    timer.unref();
    this.portPolls.set(id, timer);
  }

  private async refreshPorts(id: string): Promise<void> {
    const launch = this.resources.launches.get(id);
    if (!launch?.runtime || !isActiveLaunchStatus(launch.status)) return;
    const ports = await this.resources.supervisor.inspectRuntimeListeningPorts(
      launch.runtime,
    );
    const current = this.resources.launches.get(id);
    if (!current?.runtime || !isActiveLaunchStatus(current.status)) return;
    const key = (items: typeof ports) =>
      items
        .map(
          ({ protocol, address, port, pid }) =>
            `${protocol}:${address}:${port}:${pid}`,
        )
        .sort()
        .join("|");
    if (key(current.runtime.listeningPorts ?? []) === key(ports)) return;
    const updated = await this.updateLaunch(id, {
      runtime: { ...current.runtime, listeningPorts: ports },
    });
    await this.publish("launch.runtime_updated", { launch: updated });
  }
}

function boundedErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    4_096,
  );
}
