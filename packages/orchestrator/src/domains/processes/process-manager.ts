import type { ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  createId,
  type ProcessEnvInfo,
  type ProcessLogEvent,
  type ProcessLogQuery,
  type ProcessLogQueryResponse,
  type ProcessRecord,
  type ProcessRuntime,
  type StartProcessRequest,
  type StopProcessRequest,
} from "@nerve/shared";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { IndexStore } from "../../infrastructure/index-store/index.js";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";
import type { ApplicationLogger } from "../../logging.js";
import {
  createProcessLogCursor,
  defaultProcessSupervisor,
  isActiveProcessStatus,
  type ProcessLogCursor,
  ProcessLogService,
  ProcessReadinessService,
  ProcessRepository,
  type ProcessSupervisor,
} from "./index.js";
import {
  type ProcessLaunchConfigStore,
  UnconfiguredProcessLaunchConfigStore,
} from "./process-launch-config.store.js";

export interface ProcessManagerOptions {
  supervisor?: ProcessSupervisor;
  launchConfigs?: ProcessLaunchConfigStore;
}

interface ManagedProcess extends ProcessLogCursor {
  child?: ChildProcess;
  stopping: boolean;
  finalized: boolean;
  closePromise?: Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  }>;
  finalizationPromise?: Promise<ProcessRecord | undefined>;
  readinessTimer?: NodeJS.Timeout;
  readinessPattern?: RegExp;
}

export class ProcessManager {
  readonly processes = new Map<string, ProcessRecord>();
  private readonly managed = new Map<string, ManagedProcess>();
  private readonly processRepository: ProcessRepository;
  private readonly processLogs: ProcessLogService;
  private readonly processReadiness = new ProcessReadinessService();
  private readonly supervisor: ProcessSupervisor;
  private readonly launchConfigs: ProcessLaunchConfigStore;

  constructor(
    storage: InitializedStorage,
    private readonly events: EventBus,
    private readonly index: IndexStore,
    private readonly logger?: ApplicationLogger,
    options: ProcessManagerOptions = {},
  ) {
    this.supervisor = options.supervisor ?? defaultProcessSupervisor;
    this.launchConfigs =
      options.launchConfigs ?? new UnconfiguredProcessLaunchConfigStore();
    this.processRepository = new ProcessRepository(storage);
    this.processLogs = new ProcessLogService(events);
  }

  async hydrate(): Promise<void> {
    for (const persisted of await this.processRepository.hydrate()) {
      const wasActive = isActiveProcessStatus(persisted.status);
      const record = wasActive
        ? this.markHydratedRecordOrphaned(persisted)
        : persisted;
      await this.upsertProcess(record);
      if (wasActive) {
        await this.events.publish("process.orphaned", { process: record });
        await this.logger?.warn(
          "Process supervision lost after daemon restart",
          {
            processId: record.id,
            projectId: record.projectId,
            conversationId: record.conversationId,
            agentId: record.agentId,
            context: {
              pid: record.runtime?.childPid,
              processGroupId: record.runtime?.processGroupId,
              platform: record.runtime?.platform,
            },
          },
        );
      }
    }
  }

  listProcesses(): ProcessRecord[] {
    return [...this.processes.values()].sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    );
  }

  getProcess(processId: string): ProcessRecord {
    const process = this.processes.get(processId);
    if (!process) throw new Error("Process not found.");
    return process;
  }

  findProcessByName(name: string): ProcessRecord | undefined {
    return this.listProcesses().find((process) => process.name === name);
  }

  async startProcess(
    request: StartProcessRequest & {
      restartedFromProcessId?: string;
      workerId?: string;
    },
  ): Promise<ProcessRecord> {
    const now = new Date().toISOString();
    const id = createId("proc");
    const dir = this.processDir(id);
    await mkdir(dir, { recursive: true, mode: 0o755 });

    const envInfo = buildProcessEnvInfo(request.env);
    if (envInfo) {
      await this.launchConfigs.write(id, {
        version: 1,
        env: request.env,
        createdAt: now,
        updatedAt: now,
      });
    }

    const readiness = this.processReadiness.buildReadiness(request);
    const record: ProcessRecord = {
      id,
      name: request.name,
      workerId: request.workerId,
      projectId: request.projectId,
      conversationId: request.conversationId,
      agentId: request.agentId,
      cwd: resolve(request.cwd),
      command: request.command,
      envInfo,
      status: "starting",
      readiness,
      stdoutPath: join(dir, "stdout.log"),
      stderrPath: join(dir, "stderr.log"),
      logsPath: join(dir, "logs.jsonl"),
      startedAt: now,
      updatedAt: now,
      restartedFromProcessId: request.restartedFromProcessId,
    };

    const readinessPattern = this.processReadiness.compilePattern(
      request.readyPattern,
    );

    await this.upsertProcess(record);
    await this.events.publish("process.created", { process: record });
    await this.logger?.info("Process created", {
      processId: record.id,
      projectId: record.projectId,
      conversationId: record.conversationId,
      agentId: record.agentId,
      context: {
        name: record.name,
        cwd: record.cwd,
        command: record.command,
        envKeyCount: record.envInfo?.keys.length ?? 0,
      },
    });

    const spawned = this.supervisor.spawn(request.command, {
      cwd: record.cwd,
      env: request.env,
    });
    const { child, runtime } = spawned;
    await this.updateProcess(record.id, { runtime });

    const closePromise = new Promise<{
      exitCode: number | null;
      signal: NodeJS.Signals | null;
    }>((resolveClose) => {
      child.once("close", (exitCode, signal) => {
        resolveClose({ exitCode, signal });
      });
    });
    const managed: ManagedProcess = {
      child,
      ...createProcessLogCursor(
        await this.processLogs.latestLogSeq(record.logsPath),
      ),
      stopping: false,
      finalized: false,
      closePromise,
      readinessPattern,
    };
    managed.finalizationPromise = closePromise
      .then(({ exitCode, signal }) =>
        this.markProcessExited(record.id, exitCode, signal),
      )
      .catch(async (error: unknown) => {
        if (this.logger) {
          await this.logger
            .error("Process finalization failed", {
              processId: record.id,
              projectId: record.projectId,
              conversationId: record.conversationId,
              agentId: record.agentId,
              error,
            })
            .catch(() => undefined);
        }
        return undefined;
      });
    this.managed.set(record.id, managed);

    child.stdout?.on("data", (chunk) => {
      void this.captureOutput(record.id, "stdout", chunk);
    });
    child.stderr?.on("data", (chunk) => {
      void this.captureOutput(record.id, "stderr", chunk);
    });
    child.on("error", (error) => {
      void this.markProcessError(record.id, error.message);
    });

    await this.updateProcess(record.id, { status: "running" });
    await this.events.publish("process.started", {
      process: this.getProcess(record.id),
      pid: runtime.childPid,
      runtime,
    });
    await this.logger?.info("Process started", {
      processId: record.id,
      projectId: record.projectId,
      conversationId: record.conversationId,
      agentId: record.agentId,
      context: {
        pid: runtime.childPid,
        processGroupId: runtime.processGroupId,
        platform: runtime.platform,
      },
    });

    await this.waitForReadiness(record.id);
    return this.getProcess(record.id);
  }

  async stopProcess(
    processId: string,
    request: StopProcessRequest = {},
  ): Promise<ProcessRecord> {
    const record = this.getProcess(processId);
    if (record.status === "orphaned") {
      return this.cleanupOrphanedProcess(record.id, request);
    }
    const managed = this.managed.get(record.id);
    if (!managed?.child || !isActiveProcessStatus(record.status)) return record;

    const signal = request.signal ?? "SIGTERM";
    managed.stopping = true;
    const stopping = await this.updateProcess(record.id, {
      status: "stopping",
    });
    await this.events.publish("process.stop_requested", {
      processId: record.id,
      signal,
    });
    await this.logger?.info("Process stop requested", {
      processId: record.id,
      projectId: record.projectId,
      conversationId: record.conversationId,
      agentId: record.agentId,
      context: { signal },
    });

    void this.requestTermination(
      stopping,
      managed.child,
      signal,
      "stop requested",
    );

    const timeoutMs = request.timeoutMs ?? 5000;
    const timeoutResult = Symbol("process-stop-timeout");
    let timeout: NodeJS.Timeout | undefined;
    const finalized = await Promise.race<
      ProcessRecord | undefined | typeof timeoutResult
    >([
      managed.finalizationPromise ?? Promise.resolve(undefined),
      new Promise<typeof timeoutResult>((resolveTimeout) => {
        timeout = setTimeout(() => resolveTimeout(timeoutResult), timeoutMs);
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });

    if (finalized !== timeoutResult) {
      return finalized ?? this.getProcess(processId);
    }

    void this.requestTermination(
      this.processes.get(processId) ?? stopping,
      managed.child,
      "SIGKILL",
      `stop timed out after ${timeoutMs}ms`,
    );
    return this.forceFinalizeStoppedProcess(
      processId,
      "SIGKILL",
      `Process did not close within ${timeoutMs}ms after stop was requested.`,
    );
  }

  async restartProcess(processId: string): Promise<ProcessRecord> {
    const record = this.getProcess(processId);
    const env = await this.envForRestart(record);
    if (record.status === "orphaned") {
      await this.cleanupOrphanedProcess(record.id, { timeoutMs: 5000 });
    } else if (isActiveProcessStatus(record.status)) {
      await this.stopProcess(processId);
    }
    return this.startProcess({
      name: record.name,
      workerId: record.workerId,
      projectId: record.projectId,
      conversationId: record.conversationId,
      agentId: record.agentId,
      cwd: record.cwd,
      command: record.command,
      env,
      readyOnUrl: record.readiness.readyOnUrl,
      readyPattern: record.readiness.readyPattern,
      readyTimeoutMs: record.readiness.timeoutMs,
      restartedFromProcessId: record.id,
    });
  }

  async removeProcess(processId: string): Promise<void> {
    const record = this.getProcess(processId);
    if (isActiveProcessStatus(record.status)) {
      throw new Error("Stop the process before removing it.");
    }
    await this.launchConfigs.remove(record.id);
    const managed = this.managed.get(record.id);
    if (managed?.readinessTimer) clearTimeout(managed.readinessTimer);
    this.managed.delete(record.id);
    this.processes.delete(record.id);
    this.index.deleteProcess(record.id);
    await this.processRepository.remove(record.id);
    await this.events.publish("process.removed", { processId: record.id });
    await this.logger?.info("Process removed", {
      processId: record.id,
      projectId: record.projectId,
      conversationId: record.conversationId,
      agentId: record.agentId,
    });
  }

  async pruneProcesses(): Promise<string[]> {
    const removed: string[] = [];
    for (const record of this.listProcesses()) {
      if (isActiveProcessStatus(record.status)) continue;
      try {
        await this.removeProcess(record.id);
        removed.push(record.id);
      } catch {
        // Best-effort: skip processes that can't be removed right now.
      }
    }
    return removed;
  }

  activeProcessesForConversations(
    conversationIds: Iterable<string>,
  ): ProcessRecord[] {
    const conversations = new Set(conversationIds);
    if (conversations.size === 0) return [];
    return this.listProcesses().filter(
      (record) =>
        record.conversationId !== undefined &&
        conversations.has(record.conversationId) &&
        isActiveProcessStatus(record.status),
    );
  }

  async removeInactiveProcessesForConversations(
    conversationIds: Iterable<string>,
  ): Promise<string[]> {
    const conversations = new Set(conversationIds);
    if (conversations.size === 0) return [];
    const removed: string[] = [];
    for (const record of this.listProcesses()) {
      if (!record.conversationId || !conversations.has(record.conversationId)) {
        continue;
      }
      if (isActiveProcessStatus(record.status)) continue;
      try {
        await this.removeProcess(record.id);
        removed.push(record.id);
      } catch {
        // Best-effort: skip processes that can't be removed right now.
      }
    }
    return removed;
  }

  async queryLogs(
    processId: string,
    query: ProcessLogQuery = {},
  ): Promise<ProcessLogQueryResponse> {
    return this.processLogs.queryLogs(this.getProcess(processId), query);
  }

  private async envForRestart(
    record: ProcessRecord,
  ): Promise<Record<string, string> | undefined> {
    if (!record.envInfo?.persisted) return undefined;

    const config = await this.launchConfigs.read(record.id);
    if (!config) {
      throw new Error(
        "Process was started with persisted env metadata, but launch env is missing; refusing to restart without env.",
      );
    }

    const env = config.env;
    const missingKeys = record.envInfo.keys.filter(
      (key) => !env || !Object.hasOwn(env, key),
    );
    if (missingKeys.length > 0) {
      throw new Error(
        `Process launch env is missing persisted keys (${missingKeys.join(", ")}); refusing to restart without env.`,
      );
    }

    return env ? { ...env } : undefined;
  }

  private async captureOutput(
    processId: string,
    stream: "stdout" | "stderr",
    chunk: Buffer | string,
  ): Promise<void> {
    const record = this.processes.get(processId);
    const managed = this.managed.get(processId);
    if (!record || !managed) return;
    await this.processLogs.captureOutput(
      record,
      managed,
      stream,
      chunk,
      async (event) => this.checkReadiness(record.id, event),
    );
  }

  private async flushProcessOutputBuffers(processId: string): Promise<void> {
    const record = this.processes.get(processId);
    const managed = this.managed.get(processId);
    if (!record || !managed) return;

    try {
      await this.processLogs.flushOutputBuffers(
        record,
        managed,
        async (event) => this.checkReadiness(record.id, event),
      );
    } catch (error) {
      await this.logger
        ?.warn("Process output flush failed", {
          processId: record.id,
          projectId: record.projectId,
          conversationId: record.conversationId,
          agentId: record.agentId,
          error,
        })
        .catch(() => undefined);
    }
  }

  private async checkReadiness(
    processId: string,
    log: ProcessLogEvent,
  ): Promise<void> {
    const record = this.processes.get(processId);
    const managed = this.managed.get(processId);
    if (!record || !managed || record.readiness.outcome !== "pending") return;
    const matched = this.processReadiness.match(
      record,
      managed.readinessPattern,
      log,
    );
    if (!matched) return;
    if (managed.readinessTimer) clearTimeout(managed.readinessTimer);
    const ready = await this.updateProcess(processId, {
      status: "ready",
      readiness: {
        ...record.readiness,
        outcome: "ready",
        matched,
        readyAt: new Date().toISOString(),
      },
    });
    await this.events.publish("process.ready", { process: ready, matched });
    await this.logger?.info("Process ready", {
      processId: ready.id,
      projectId: ready.projectId,
      conversationId: ready.conversationId,
      agentId: ready.agentId,
      context: { matched },
    });
  }

  private async waitForReadiness(processId: string): Promise<void> {
    const record = this.getProcess(processId);
    if (record.readiness.outcome !== "pending") return;
    const managed = this.managed.get(processId);
    const timeoutMs = record.readiness.timeoutMs ?? 3000;
    if (!managed || timeoutMs <= 0) return;
    await new Promise<void>((resolveWait) => {
      let unsubscribe: () => void = () => undefined;
      const resolveOnce = () => {
        unsubscribe();
        resolveWait();
      };
      managed.readinessTimer = setTimeout(() => {
        void this.markReadinessTimeout(processId).finally(resolveOnce);
      }, timeoutMs);
      unsubscribe = this.events.subscribe((event) => {
        if (event.type !== "process.ready" && event.type !== "process.exited")
          return;
        const data = event.data as { process?: { id?: string } };
        if (data.process?.id !== processId) return;
        resolveOnce();
      });
    });
  }

  private async markReadinessTimeout(processId: string): Promise<void> {
    const record = this.processes.get(processId);
    if (!record || record.readiness.outcome !== "pending") return;
    const updated = await this.updateProcess(processId, {
      readiness: { ...record.readiness, outcome: "timeout" },
    });
    await this.events.publish("process.ready_timeout", { process: updated });
    await this.logger?.warn("Process readiness timed out", {
      processId: updated.id,
      projectId: updated.projectId,
      conversationId: updated.conversationId,
      agentId: updated.agentId,
      context: { timeoutMs: updated.readiness.timeoutMs },
    });
  }

  private async requestTermination(
    record: ProcessRecord,
    child: ChildProcess,
    signal: NodeJS.Signals,
    reason: string,
  ): Promise<void> {
    try {
      const result = await this.supervisor.terminate(child, signal);
      if (!result.error) return;
      if (this.logger) {
        await this.logger
          .warn("Process termination reported an error", {
            processId: record.id,
            projectId: record.projectId,
            conversationId: record.conversationId,
            agentId: record.agentId,
            context: {
              signal,
              reason,
              method: result.method,
              error: result.error,
            },
          })
          .catch(() => undefined);
      }
    } catch (error) {
      if (this.logger) {
        await this.logger
          .warn("Process termination failed", {
            processId: record.id,
            projectId: record.projectId,
            conversationId: record.conversationId,
            agentId: record.agentId,
            error,
            context: { signal, reason },
          })
          .catch(() => undefined);
      }
    }
  }

  private markHydratedRecordOrphaned(record: ProcessRecord): ProcessRecord {
    return {
      ...record,
      status: "orphaned",
      error: this.orphanedHydrateMessage(record.runtime),
      updatedAt: new Date().toISOString(),
    };
  }

  private orphanedHydrateMessage(runtime: ProcessRuntime | undefined): string {
    if (runtime?.childPid) {
      return `Process supervision was lost after daemon restart. Use process_stop to attempt cleanup of PID ${runtime.childPid}.`;
    }
    if (runtime?.processGroupId) {
      return `Process supervision was lost after daemon restart. Use process_stop to attempt cleanup of process group ${runtime.processGroupId}.`;
    }
    return "Process supervision was lost after daemon restart, and no PID metadata was captured.";
  }

  private async cleanupOrphanedProcess(
    processId: string,
    request: StopProcessRequest,
  ): Promise<ProcessRecord> {
    const record = this.getProcess(processId);
    if (record.status !== "orphaned") return record;

    const validationError = this.orphanCleanupValidationError(record.runtime);
    if (validationError) {
      await this.failOrphanCleanup(record, validationError);
    }
    const runtime = record.runtime as ProcessRuntime;
    const initialSignal = request.signal ?? "SIGTERM";
    const timeoutMs = request.timeoutMs ?? 5000;

    await this.events.publish("process.stop_requested", {
      processId: record.id,
      signal: initialSignal,
      orphaned: true,
    });
    await this.logger?.info("Orphaned process cleanup requested", {
      processId: record.id,
      projectId: record.projectId,
      conversationId: record.conversationId,
      agentId: record.agentId,
      context: this.runtimeLogContext(runtime, { signal: initialSignal }),
    });

    if (runtime.platform === "win32") {
      const result = await this.terminateRuntimeForCleanup(
        record,
        runtime,
        "SIGKILL",
      );
      if (!result.attempted || result.error) {
        await this.failOrphanCleanup(
          record,
          result.error ?? "Could not clean up orphaned process runtime target.",
          { method: result.method, signal: "SIGKILL" },
        );
      }
      return this.finalizeOrphanCleanup(record.id, "SIGKILL", runtime, {
        method: result.method,
      });
    }

    const initialResult = await this.terminateRuntimeForCleanup(
      record,
      runtime,
      initialSignal,
    );
    if (!initialResult.attempted || initialResult.method === "none") {
      await this.failOrphanCleanup(
        record,
        initialResult.error ??
          "Could not signal orphaned process runtime target.",
        { method: initialResult.method, signal: initialSignal },
      );
    }
    if (initialResult.error) {
      await this.logger?.warn(
        "Orphaned process cleanup signal reported an error",
        {
          processId: record.id,
          projectId: record.projectId,
          conversationId: record.conversationId,
          agentId: record.agentId,
          context: this.runtimeLogContext(runtime, {
            signal: initialSignal,
            method: initialResult.method,
            error: initialResult.error,
          }),
        },
      );
    }

    let finalSignal = initialSignal;
    if (!(await this.waitForRuntimeTargetExit(runtime, timeoutMs))) {
      finalSignal = "SIGKILL";
      const killResult = await this.terminateRuntimeForCleanup(
        record,
        runtime,
        finalSignal,
      );
      if (!killResult.attempted || killResult.method === "none") {
        await this.failOrphanCleanup(
          record,
          killResult.error ??
            "Could not force-kill orphaned process runtime target.",
          { method: killResult.method, signal: finalSignal },
        );
      }
      if (killResult.error && (await this.isRuntimeTargetAlive(runtime))) {
        await this.failOrphanCleanup(record, killResult.error, {
          method: killResult.method,
          signal: finalSignal,
        });
      }
    }

    return this.finalizeOrphanCleanup(record.id, finalSignal, runtime);
  }

  private orphanCleanupValidationError(
    runtime: ProcessRuntime | undefined,
  ): string | undefined {
    if (!runtime) {
      return "Cannot clean up orphaned process because no PID metadata was captured.";
    }
    if (runtime.platform !== process.platform) {
      return `Cannot clean up process spawned on ${runtime.platform} from ${process.platform}.`;
    }
    if (runtime.platform === "win32" && !runtime.childPid) {
      return "Cannot clean up orphaned process because no child PID metadata was captured.";
    }
    if (
      runtime.platform !== "win32" &&
      !runtime.processGroupId &&
      !runtime.childPid
    ) {
      return "Cannot clean up orphaned process because no process-group or child PID metadata was captured.";
    }
    return undefined;
  }

  private async terminateRuntimeForCleanup(
    record: ProcessRecord,
    runtime: ProcessRuntime,
    signal: NodeJS.Signals,
  ) {
    try {
      return await this.supervisor.terminateRuntime(runtime, signal);
    } catch (error) {
      await this.logger?.warn("Orphaned process cleanup termination threw", {
        processId: record.id,
        projectId: record.projectId,
        conversationId: record.conversationId,
        agentId: record.agentId,
        error,
        context: this.runtimeLogContext(runtime, { signal }),
      });
      return {
        attempted: false,
        method: "none" as const,
        error: this.errorMessage(error),
      };
    }
  }

  private async waitForRuntimeTargetExit(
    runtime: ProcessRuntime,
    timeoutMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (true) {
      if (!(await this.isRuntimeTargetAlive(runtime))) return true;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      await delay(Math.min(50, remaining));
    }
  }

  private async isRuntimeTargetAlive(
    runtime: ProcessRuntime,
  ): Promise<boolean> {
    try {
      return await this.supervisor.isRuntimeTargetAlive(runtime);
    } catch (error) {
      await this.logger?.warn("Orphaned process liveness check failed", {
        error,
        context: this.runtimeLogContext(runtime),
      });
      return true;
    }
  }

  private async finalizeOrphanCleanup(
    processId: string,
    finalSignal: NodeJS.Signals,
    runtime: ProcessRuntime,
    context: Record<string, unknown> = {},
  ): Promise<ProcessRecord> {
    const record = this.getProcess(processId);
    if (record.status !== "orphaned") return record;
    const managed = this.managed.get(processId);
    if (managed?.readinessTimer) clearTimeout(managed.readinessTimer);

    const readiness =
      record.readiness.outcome === "pending"
        ? { ...record.readiness, outcome: "exited" as const }
        : record.readiness;
    const updated = await this.updateProcess(processId, {
      status: "stopped",
      readiness,
      exitedAt: new Date().toISOString(),
      exitCode: null,
      signal: finalSignal,
      error: undefined,
    });
    this.managed.delete(processId);
    await this.events.publish("process.exited", { process: updated });
    await this.events.publish("process.orphan_cleanup_succeeded", {
      process: updated,
      runtime,
      signal: finalSignal,
      ...context,
    });
    await this.logger?.info("Orphaned process cleanup completed", {
      processId: updated.id,
      projectId: updated.projectId,
      conversationId: updated.conversationId,
      agentId: updated.agentId,
      context: this.runtimeLogContext(runtime, {
        signal: finalSignal,
        ...context,
      }),
    });
    return updated;
  }

  private async failOrphanCleanup(
    record: ProcessRecord,
    message: string,
    context: Record<string, unknown> = {},
  ): Promise<never> {
    const updated = await this.updateProcess(record.id, { error: message });
    await this.events.publish("process.cleanup_failed", {
      process: updated,
      error: message,
      orphaned: true,
      ...context,
    });
    await this.logger?.warn("Orphaned process cleanup failed", {
      processId: updated.id,
      projectId: updated.projectId,
      conversationId: updated.conversationId,
      agentId: updated.agentId,
      context: this.runtimeLogContext(updated.runtime, {
        error: message,
        ...context,
      }),
    });
    throw new Error(message);
  }

  private runtimeLogContext(
    runtime: ProcessRuntime | undefined,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      pid: runtime?.childPid,
      processGroupId: runtime?.processGroupId,
      platform: runtime?.platform,
      detached: runtime?.detached,
      shell: runtime?.shell,
      spawnedAt: runtime?.spawnedAt,
      ...extra,
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async forceFinalizeStoppedProcess(
    processId: string,
    signal: NodeJS.Signals,
    reason: string,
  ): Promise<ProcessRecord> {
    const record = this.getProcess(processId);
    if (!isActiveProcessStatus(record.status)) return record;

    const managed = this.managed.get(processId);
    if (managed?.readinessTimer) clearTimeout(managed.readinessTimer);
    if (managed) managed.finalized = true;

    await this.flushProcessOutputBuffers(processId);

    const freshRecord = this.processes.get(processId) ?? record;
    const readiness =
      freshRecord.readiness.outcome === "pending"
        ? { ...freshRecord.readiness, outcome: "exited" as const }
        : freshRecord.readiness;
    const updated = await this.updateProcess(processId, {
      status: "stopped",
      readiness,
      exitedAt: new Date().toISOString(),
      exitCode: null,
      signal,
    });
    this.managed.delete(processId);
    await this.events.publish("process.exited", { process: updated });
    await this.logger?.warn("Process stop force-finalized", {
      processId: updated.id,
      projectId: updated.projectId,
      conversationId: updated.conversationId,
      agentId: updated.agentId,
      context: { signal, reason },
    });
    return updated;
  }

  private async markProcessExited(
    processId: string,
    exitCode: number | null,
    signal: NodeJS.Signals | null,
  ): Promise<ProcessRecord | undefined> {
    const record = this.processes.get(processId);
    const managed = this.managed.get(processId);
    if (!record) return undefined;
    if (!isActiveProcessStatus(record.status)) return record;
    if (managed?.finalized) return record;
    if (managed?.readinessTimer) clearTimeout(managed.readinessTimer);
    if (managed) managed.finalized = true;

    await this.flushProcessOutputBuffers(processId);

    const freshRecord = this.processes.get(processId);
    if (!freshRecord) return undefined;
    if (!isActiveProcessStatus(freshRecord.status)) return freshRecord;

    const status = managed?.stopping
      ? "stopped"
      : exitCode === 0
        ? "exited"
        : "error";
    const readiness =
      freshRecord.readiness.outcome === "pending"
        ? { ...freshRecord.readiness, outcome: "exited" as const }
        : freshRecord.readiness;
    const updated = await this.updateProcess(processId, {
      status,
      readiness,
      exitedAt: new Date().toISOString(),
      exitCode,
      signal,
    });
    this.managed.delete(processId);
    await this.events.publish("process.exited", { process: updated });
    await this.logger?.[status === "error" ? "error" : "info"](
      "Process exited",
      {
        processId: updated.id,
        projectId: updated.projectId,
        conversationId: updated.conversationId,
        agentId: updated.agentId,
        context: { exitCode, signal, status },
      },
    );
    return updated;
  }

  private async markProcessError(
    processId: string,
    message: string,
  ): Promise<void> {
    const record = this.processes.get(processId);
    const managed = this.managed.get(processId);
    if (!record || !isActiveProcessStatus(record.status)) return;
    if (managed?.finalized) return;
    if (managed?.readinessTimer) clearTimeout(managed.readinessTimer);
    if (managed) managed.finalized = true;

    await this.flushProcessOutputBuffers(processId);

    const freshRecord = this.processes.get(processId);
    if (!freshRecord || !isActiveProcessStatus(freshRecord.status)) return;

    const updated = await this.updateProcess(processId, {
      status: "error",
      error: message,
    });
    this.managed.delete(processId);
    await this.events.publish("process.error", { process: updated, message });
    await this.logger?.error("Process error", {
      processId: updated.id,
      projectId: updated.projectId,
      conversationId: updated.conversationId,
      agentId: updated.agentId,
      context: { message },
    });
  }

  private async updateProcess(
    processId: string,
    patch: Partial<Omit<ProcessRecord, "id" | "startedAt">>,
  ): Promise<ProcessRecord> {
    const current = this.getProcess(processId);
    const updated: ProcessRecord = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await this.upsertProcess(updated);
    return updated;
  }

  private async upsertProcess(record: ProcessRecord): Promise<void> {
    this.processes.set(record.id, record);
    this.index.upsertProcess(record);
    await this.writeProcess(record);
  }

  private async writeProcess(record: ProcessRecord): Promise<void> {
    await this.processRepository.write(record);
  }

  private processDir(processId: string): string {
    return this.processRepository.processDir(processId);
  }
}

function buildProcessEnvInfo(
  env?: Record<string, string>,
): ProcessEnvInfo | undefined {
  const keys = Object.keys(env ?? {})
    .filter((key) => key.length > 0)
    .sort();
  if (keys.length === 0) return undefined;
  return { keys, persisted: true, redacted: true };
}

export { isActiveProcessStatus } from "./index.js";
