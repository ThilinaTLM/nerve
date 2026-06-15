import type { ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createId,
  type ProcessLogEvent,
  type ProcessLogQuery,
  type ProcessLogQueryResponse,
  type ProcessRecord,
  type StartProcessRequest,
  type StopProcessRequest,
} from "@nerve/shared";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { IndexStore } from "../../infrastructure/index-store/index.js";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";
import type { ApplicationLogger } from "../../logging.js";
import {
  defaultProcessSupervisor,
  isActiveProcessStatus,
  ProcessLogService,
  ProcessReadinessService,
  ProcessRepository,
  type ProcessSupervisor,
} from "./index.js";

interface ManagedProcess {
  child?: ChildProcess;
  logSeq: number;
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

  constructor(
    storage: InitializedStorage,
    private readonly events: EventBus,
    private readonly index: IndexStore,
    private readonly logger?: ApplicationLogger,
    private readonly supervisor: ProcessSupervisor = defaultProcessSupervisor,
  ) {
    this.processRepository = new ProcessRepository(storage);
    this.processLogs = new ProcessLogService(events);
  }

  async hydrate(): Promise<void> {
    for (const record of await this.processRepository.hydrate()) {
      this.processes.set(record.id, record);
      this.index.upsertProcess(record);
      await this.processRepository.write(record);
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
      context: { name: record.name, cwd: record.cwd, command: record.command },
    });

    const child = this.supervisor.spawn(request.command, {
      cwd: record.cwd,
      env: request.env,
    });

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
      logSeq: await this.processLogs.latestLogSeq(record.logsPath),
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
      pid: child.pid,
    });
    await this.logger?.info("Process started", {
      processId: record.id,
      projectId: record.projectId,
      conversationId: record.conversationId,
      agentId: record.agentId,
      context: { pid: child.pid },
    });

    await this.waitForReadiness(record.id);
    return this.getProcess(record.id);
  }

  async stopProcess(
    processId: string,
    request: StopProcessRequest = {},
  ): Promise<ProcessRecord> {
    const record = this.getProcess(processId);
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
    if (isActiveProcessStatus(record.status)) await this.stopProcess(processId);
    return this.startProcess({
      name: record.name,
      workerId: record.workerId,
      projectId: record.projectId,
      conversationId: record.conversationId,
      agentId: record.agentId,
      cwd: record.cwd,
      command: record.command,
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

    const readiness =
      record.readiness.outcome === "pending"
        ? { ...record.readiness, outcome: "exited" as const }
        : record.readiness;
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
    const status = managed?.stopping
      ? "stopped"
      : exitCode === 0
        ? "exited"
        : "error";
    const readiness =
      record.readiness.outcome === "pending"
        ? { ...record.readiness, outcome: "exited" as const }
        : record.readiness;
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

export { isActiveProcessStatus } from "./index.js";
