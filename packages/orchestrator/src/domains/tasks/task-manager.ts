import type { ChildProcess } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  type CancelTaskRequest,
  createId,
  type StartTaskRequest,
  type TaskEnvInfo,
  type TaskLogEvent,
  type TaskLogQuery,
  type TaskLogQueryResponse,
  type TaskRecord,
  type TaskRuntime,
} from "@nerve/shared";
import {
  buildProcessResult,
  buildProcessTextResult,
  type ToolExecutionResult,
} from "@nerve/tools";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { IndexStore } from "../../infrastructure/index-store/index.js";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";
import type { ApplicationLogger } from "../../logging.js";
import {
  createTaskLogCursor,
  defaultTaskSupervisor,
  isActiveTaskStatus,
  type TaskLogCursor,
  TaskLogService,
  TaskReadinessService,
  TaskRepository,
  type TaskSupervisor,
} from "./index.js";
import type { LegacyProcessRecord } from "./task.repository.js";
import {
  type TaskLaunchConfigStore,
  UnconfiguredTaskLaunchConfigStore,
} from "./task-launch-config.store.js";

export interface TaskManagerOptions {
  supervisor?: TaskSupervisor;
  launchConfigs?: TaskLaunchConfigStore;
}

export type ForegroundBashPromotionInput = {
  command: string;
  cwd: string;
  timeoutMs?: number;
  autoPromoteAfterMs: number;
  origin: Extract<TaskRecord["origin"], { kind: "agent_tool" }>;
  signal?: AbortSignal;
};

export type ForegroundBashPromotionResult =
  | { kind: "completed_foreground"; result: ToolExecutionResult }
  | {
      kind: "promoted";
      task: TaskRecord;
      result: ToolExecutionResult;
      elapsedMs: number;
    };

interface ManagedTask extends TaskLogCursor {
  child?: ChildProcess;
  stopping: boolean;
  finalized: boolean;
  closePromise?: Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  }>;
  finalizationPromise?: Promise<TaskRecord | undefined>;
  readinessTimer?: NodeJS.Timeout;
  readinessPollAbort?: AbortController;
  runtimeTimer?: NodeJS.Timeout;
  readinessPattern?: RegExp;
  timedOut?: boolean;
}

export class TaskManager {
  readonly tasks = new Map<string, TaskRecord>();
  private readonly managed = new Map<string, ManagedTask>();
  private readonly taskRepository: TaskRepository;
  private readonly taskLogs: TaskLogService;
  private readonly taskReadiness = new TaskReadinessService();
  private readonly supervisor: TaskSupervisor;
  private readonly launchConfigs: TaskLaunchConfigStore;

  constructor(
    storage: InitializedStorage,
    private readonly events: EventBus,
    private readonly index: IndexStore,
    private readonly logger?: ApplicationLogger,
    options: TaskManagerOptions = {},
  ) {
    this.supervisor = options.supervisor ?? defaultTaskSupervisor;
    this.launchConfigs =
      options.launchConfigs ?? new UnconfiguredTaskLaunchConfigStore();
    this.taskRepository = new TaskRepository(storage);
    this.taskLogs = new TaskLogService(events);
  }

  async hydrate(): Promise<void> {
    for (const persisted of await this.taskRepository.hydrate()) {
      const wasActive = isActiveTaskStatus(persisted.status);
      const record = wasActive
        ? this.markHydratedRecordOrphaned(persisted)
        : persisted;
      await this.upsertTask(record);
      if (wasActive) {
        await this.events.publish("task.orphaned", { task: record });
        await this.logger?.warn("Task supervision lost after daemon restart", {
          taskId: record.id,
          projectId: record.projectId,
          conversationId: record.conversationId,
          agentId: record.agentId,
          context: {
            pid: record.runtime?.childPid,
            processGroupId: record.runtime?.processGroupId,
            platform: record.runtime?.platform,
          },
        });
      }
    }
    await this.migrateLegacyProcesses();
  }

  private async migrateLegacyProcesses(): Promise<void> {
    for (const legacy of await this.taskRepository.hydrateLegacyProcesses()) {
      if (this.findTaskByLegacyProcessId(legacy.id)) continue;
      const record = this.legacyProcessToTask(legacy);
      await mkdir(this.taskDir(record.id), { recursive: true, mode: 0o755 });
      await this.upsertTask(record);
      await this.events.publish("task.orphaned", { task: record });
    }
  }

  private findTaskByLegacyProcessId(processId: string): TaskRecord | undefined {
    return [...this.tasks.values()].find(
      (task) => task.legacyProcessId === processId,
    );
  }

  private legacyProcessToTask(legacy: LegacyProcessRecord): TaskRecord {
    const now = new Date().toISOString();
    const id = createId("task");
    const dir = this.taskDir(id);
    return {
      id,
      name: legacy.name,
      workerId: legacy.workerId,
      projectId: legacy.projectId,
      conversationId: legacy.conversationId,
      agentId: legacy.agentId,
      cwd: resolve(legacy.cwd),
      command: legacy.command,
      envInfo: legacy.envInfo,
      status: "orphaned",
      readiness: legacy.readiness ?? { outcome: "none" },
      stdoutPath: legacy.stdoutPath ?? join(dir, "stdout.log"),
      stderrPath: legacy.stderrPath ?? join(dir, "stderr.log"),
      logsPath: legacy.logsPath ?? join(dir, "logs.jsonl"),
      startedAt: legacy.startedAt ?? now,
      updatedAt: now,
      finishedAt: legacy.exitedAt,
      exitCode: legacy.exitCode,
      signal: legacy.signal,
      error:
        legacy.error ??
        `Legacy process ${legacy.id} was migrated as an orphaned task after the task rename.`,
      runtime: legacy.runtime,
      legacyProcessId: legacy.id,
      origin: { kind: "api" },
      completion: { inject: false, outputTailLineCount: 80 },
      visibility: "background",
    };
  }

  listTasks(options: { includeForeground?: boolean } = {}): TaskRecord[] {
    return [...this.tasks.values()]
      .filter(
        (task) =>
          options.includeForeground === true ||
          task.visibility !== "foreground",
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  getTask(taskId: string): TaskRecord {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error("Task not found.");
    return task;
  }

  findTaskByName(name: string): TaskRecord | undefined {
    return this.listTasks().find((task) => task.name === name);
  }

  async startTask(
    request: StartTaskRequest & {
      restartedFromTaskId?: string;
      workerId?: string;
      origin?: TaskRecord["origin"];
      completion?: TaskRecord["completion"];
      visibility?: TaskRecord["visibility"];
    },
  ): Promise<TaskRecord> {
    const now = new Date().toISOString();
    const id = createId("task");
    const dir = this.taskDir(id);
    await mkdir(dir, { recursive: true, mode: 0o755 });

    const envInfo = buildTaskEnvInfo(request.env);
    if (envInfo) {
      await this.launchConfigs.write(id, {
        version: 1,
        env: request.env,
        createdAt: now,
        updatedAt: now,
      });
    }

    const readiness = this.taskReadiness.buildReadiness(request);
    const notify = defaultTaskNotificationsEnabled(request);
    const injectCompletion = request.injectCompletion ?? false;
    const restartSource = request.restartedFromTaskId
      ? this.tasks.get(request.restartedFromTaskId)
      : undefined;
    const restartRootTaskId = restartSource
      ? (restartSource.restartRootTaskId ?? restartSource.id)
      : request.restartedFromTaskId
        ? request.restartedFromTaskId
        : id;
    const restartGeneration = restartSource
      ? (restartSource.restartGeneration ?? 0) + 1
      : request.restartedFromTaskId
        ? 1
        : 0;
    const completion =
      request.completion ??
      (injectCompletion
        ? { inject: true, outputTailLineCount: 80 }
        : request.injectCompletion === false
          ? { inject: false, outputTailLineCount: 80 }
          : undefined);
    const notifications = {
      enabled: notify,
      ready: notify,
      terminal: notify,
      outputTailLineCount: 80,
    };
    const record: TaskRecord = {
      id,
      name: request.name,
      groupId: request.groupId,
      groupName: request.groupName,
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
      timeoutMs: request.timeoutMs,
      restartedFromTaskId: request.restartedFromTaskId,
      restartRootTaskId,
      restartGeneration,
      origin: request.origin ?? { kind: "api" },
      completion,
      notifications,
      visibility: request.visibility ?? "background",
    };

    const readinessPattern = this.taskReadiness.compilePattern(
      request.readyPattern,
    );

    await this.upsertTask(record);
    await this.events.publish("task.created", { task: record });
    await this.logger?.info("Task created", {
      taskId: record.id,
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
    await this.updateTask(record.id, { runtime });

    const closePromise = new Promise<{
      exitCode: number | null;
      signal: NodeJS.Signals | null;
    }>((resolveClose) => {
      child.once("close", (exitCode, signal) => {
        resolveClose({ exitCode, signal });
      });
    });
    const managed: ManagedTask = {
      child,
      ...createTaskLogCursor(await this.taskLogs.latestLogSeq(record.logsPath)),
      stopping: false,
      finalized: false,
      closePromise,
      readinessPattern,
    };
    managed.finalizationPromise = closePromise
      .then(({ exitCode, signal }) =>
        this.markTaskExited(record.id, exitCode, signal),
      )
      .catch(async (error: unknown) => {
        if (this.logger) {
          await this.logger
            .error("Task finalization failed", {
              taskId: record.id,
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
      void this.markTaskError(record.id, error.message);
    });

    await this.updateTask(record.id, { status: "running" });
    this.scheduleReadyUrlPolling(record.id);
    this.scheduleReadinessTimeout(record.id);
    this.scheduleRuntimeTimeout(record.id, request.timeoutMs);
    await this.events.publish("task.started", {
      task: this.getTask(record.id),
      pid: runtime.childPid,
      runtime,
    });
    await this.logger?.info("Task started", {
      taskId: record.id,
      projectId: record.projectId,
      conversationId: record.conversationId,
      agentId: record.agentId,
      context: {
        pid: runtime.childPid,
        processGroupId: runtime.processGroupId,
        platform: runtime.platform,
      },
    });

    return this.getTask(record.id);
  }

  async cancelTask(
    taskId: string,
    request: CancelTaskRequest = {},
  ): Promise<TaskRecord> {
    const record = this.getTask(taskId);
    if (record.status === "orphaned") {
      return this.cleanupOrphanedTask(record.id, request);
    }
    const managed = this.managed.get(record.id);
    if (!managed?.child || !isActiveTaskStatus(record.status)) return record;

    const signal = request.signal ?? "SIGTERM";
    managed.stopping = true;
    this.clearReadinessWatch(managed);
    const stopping = await this.updateTask(record.id, {
      status: "stopping",
    });
    await this.events.publish("task.stop_requested", {
      taskId: record.id,
      signal,
    });
    await this.logger?.info("Task stop requested", {
      taskId: record.id,
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
    const timeoutResult = Symbol("task-stop-timeout");
    let timeout: NodeJS.Timeout | undefined;
    const finalized = await Promise.race<
      TaskRecord | undefined | typeof timeoutResult
    >([
      managed.finalizationPromise ?? Promise.resolve(undefined),
      new Promise<typeof timeoutResult>((resolveTimeout) => {
        timeout = setTimeout(() => resolveTimeout(timeoutResult), timeoutMs);
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });

    if (finalized !== timeoutResult) {
      return finalized ?? this.getTask(taskId);
    }

    void this.requestTermination(
      this.tasks.get(taskId) ?? stopping,
      managed.child,
      "SIGKILL",
      `stop timed out after ${timeoutMs}ms`,
    );
    return this.forceFinalizeCancelledTask(
      taskId,
      "SIGKILL",
      `Task did not close within ${timeoutMs}ms after stop was requested.`,
    );
  }

  async restartTask(taskId: string): Promise<TaskRecord> {
    const record = this.getTask(taskId);
    const env = await this.envForRestart(record);
    if (record.status === "orphaned") {
      await this.cleanupOrphanedTask(record.id, { timeoutMs: 5000 });
    } else if (isActiveTaskStatus(record.status)) {
      await this.cancelTask(taskId);
    }
    return this.startTask({
      name: record.name,
      groupId: record.groupId,
      groupName: record.groupName,
      workerId: record.workerId,
      projectId: record.projectId,
      conversationId: record.conversationId,
      agentId: record.agentId,
      cwd: record.cwd,
      command: record.command,
      env,
      readyUrl: record.readiness.readyUrl,
      readyOnUrl: record.readiness.readyOnUrl,
      readyPattern: record.readiness.readyPattern,
      readyTimeoutMs: record.readiness.timeoutMs,
      timeoutMs: record.timeoutMs,
      notify: record.notifications?.enabled,
      injectCompletion: record.completion?.inject,
      origin: record.origin,
      completion: record.completion
        ? { ...record.completion, entryId: undefined, injectedAt: undefined }
        : undefined,
      visibility: record.visibility,
      restartedFromTaskId: record.id,
    });
  }

  async removeTask(taskId: string): Promise<void> {
    const record = this.getTask(taskId);
    if (isActiveTaskStatus(record.status)) {
      throw new Error("Stop the task before removing it.");
    }
    await this.launchConfigs.remove(record.id);
    const managed = this.managed.get(record.id);
    this.clearReadinessWatch(managed);
    this.managed.delete(record.id);
    this.tasks.delete(record.id);
    this.index.deleteTask(record.id);
    await this.taskRepository.remove(record.id);
    if (record.legacyProcessId) {
      await this.taskRepository.removeLegacyProcess(record.legacyProcessId);
    }
    await this.events.publish("task.removed", { taskId: record.id });
    await this.logger?.info("Task removed", {
      taskId: record.id,
      projectId: record.projectId,
      conversationId: record.conversationId,
      agentId: record.agentId,
    });
  }

  async pruneTasks(): Promise<string[]> {
    const removed: string[] = [];
    for (const record of this.listTasks()) {
      if (isActiveTaskStatus(record.status)) continue;
      try {
        await this.removeTask(record.id);
        removed.push(record.id);
      } catch {
        // Best-effort: skip tasks that can't be removed right now.
      }
    }
    return removed;
  }

  activeTasksForConversations(conversationIds: Iterable<string>): TaskRecord[] {
    const conversations = new Set(conversationIds);
    if (conversations.size === 0) return [];
    return this.listTasks().filter(
      (record) =>
        record.conversationId !== undefined &&
        conversations.has(record.conversationId) &&
        isActiveTaskStatus(record.status),
    );
  }

  async removeInactiveTasksForConversations(
    conversationIds: Iterable<string>,
  ): Promise<string[]> {
    const conversations = new Set(conversationIds);
    if (conversations.size === 0) return [];
    const removed: string[] = [];
    for (const record of this.listTasks()) {
      if (!record.conversationId || !conversations.has(record.conversationId)) {
        continue;
      }
      if (isActiveTaskStatus(record.status)) continue;
      try {
        await this.removeTask(record.id);
        removed.push(record.id);
      } catch {
        // Best-effort: skip tasks that can't be removed right now.
      }
    }
    return removed;
  }

  async queryLogs(
    taskId: string,
    query: TaskLogQuery = {},
  ): Promise<TaskLogQueryResponse> {
    return this.taskLogs.queryLogs(this.getTask(taskId), query);
  }

  private async buildForegroundBashResult(
    taskId: string,
  ): Promise<ToolExecutionResult> {
    const task = this.getTask(taskId);
    const [stdout, stderr] = await Promise.all([
      readFile(task.stdoutPath).catch(() => Buffer.alloc(0)),
      readFile(task.stderrPath).catch(() => Buffer.alloc(0)),
    ]);
    const combined = Buffer.concat([stdout, stderr]);
    return buildProcessResult({
      stdoutChunks: stdout.length > 0 ? [stdout] : [],
      stderrChunks: stderr.length > 0 ? [stderr] : [],
      combinedChunks: combined.length > 0 ? [combined] : [],
      code: task.exitCode ?? null,
      signal: (task.signal as NodeJS.Signals | null | undefined) ?? null,
      outputFilePrefix: "nerve-bash",
      exitMessagePrefix: "Command",
      dataDir: this.taskRepository.storageHome,
      details: { foregroundTaskId: task.id },
    });
  }

  async runForegroundBashWithPromotion(
    input: ForegroundBashPromotionInput,
  ): Promise<ForegroundBashPromotionResult> {
    const startedAt = Date.now();
    const task = await this.startTask({
      cwd: input.cwd,
      command: input.command,
      timeoutMs: input.timeoutMs,
      injectCompletion: false,
      origin: input.origin,
      completion: { inject: false, outputTailLineCount: 80 },
      visibility: "foreground",
    });
    const managed = this.managed.get(task.id);
    if (!managed?.finalizationPromise) {
      throw new Error("Foreground bash task did not start correctly.");
    }

    let abortHandler: (() => void) | undefined;
    const abortPromise = new Promise<"aborted">((resolveAbort) => {
      abortHandler = () => resolveAbort("aborted");
      input.signal?.addEventListener("abort", abortHandler, { once: true });
    });
    const promotionDelayMs = input.timeoutMs
      ? Math.min(input.autoPromoteAfterMs, input.timeoutMs + 5500)
      : input.autoPromoteAfterMs;
    const promotionPromise = new Promise<"promote">((resolvePromote) => {
      setTimeout(() => resolvePromote("promote"), promotionDelayMs);
    });
    const completionPromise = managed.finalizationPromise.then(
      () => "completed" as const,
    );

    const outcome = await Promise.race([
      completionPromise,
      promotionPromise,
      abortPromise,
    ]);
    if (abortHandler) input.signal?.removeEventListener("abort", abortHandler);

    if (outcome === "aborted") {
      await this.cancelTask(task.id, {
        reason: "Foreground bash aborted.",
      }).catch(() => undefined);
      await this.removeTask(task.id).catch(() => undefined);
      throw new Error("Command aborted.");
    }

    if (outcome === "completed") {
      const result = await this.buildForegroundBashResult(task.id);
      await this.removeTask(task.id).catch(() => undefined);
      return { kind: "completed_foreground", result };
    }

    const latest = this.getTask(task.id);
    if (!isActiveTaskStatus(latest.status)) {
      const result = await this.buildForegroundBashResult(task.id);
      await this.removeTask(task.id).catch(() => undefined);
      return { kind: "completed_foreground", result };
    }

    const promoted = await this.updateTask(task.id, {
      visibility: "background",
      completion: { inject: true, outputTailLineCount: 80 },
      notifications: {
        enabled: true,
        ready: true,
        terminal: true,
        outputTailLineCount: 80,
      },
    });
    await this.events.publish("task.promoted", { task: promoted });
    const elapsedMs = Date.now() - startedAt;
    const logs = await this.queryLogs(promoted.id, {
      mode: "recent",
      limit: 40,
    });
    const recentOutput = logs.events
      .map(
        (event) =>
          `[${event.seq} ${event.stream} ${event.level}] ${event.line}`,
      )
      .join("\n");
    const text = [
      `Command is still running after ${Math.round(elapsedMs / 1000)}s and was promoted to background task ${promoted.id}.`,
      "",
      `Command: ${promoted.command}`,
      `Elapsed: ${Math.round(elapsedMs / 1000)}s`,
      "",
      "Recent output:",
      recentOutput || "(no captured log lines yet)",
      "",
      "No polling is needed; Nerve will notify/continue this agent when the command reaches a terminal status.",
      `Use task_logs with taskId "${promoted.id}" to inspect output if needed.`,
      `Use task_cancel with taskId "${promoted.id}" to terminate it.`,
    ].join("\n");
    const result = await buildProcessTextResult({
      text,
      outputFilePrefix: "nerve-task-promotion",
      exitMessagePrefix: "Command promotion",
      dataDir: this.taskRepository.storageHome,
      details: {
        promotedToTask: true,
        task: promoted,
        elapsedMs,
      },
    });
    return { kind: "promoted", task: promoted, result, elapsedMs };
  }

  async markCompletionInjected(
    taskId: string,
    entryId: string,
    injectedAt = new Date().toISOString(),
  ): Promise<TaskRecord> {
    const record = this.getTask(taskId);
    return this.updateTask(taskId, {
      completion: {
        inject: record.completion?.inject ?? false,
        outputTailLineCount: record.completion?.outputTailLineCount ?? 80,
        ...record.completion,
        entryId,
        injectedAt,
      },
    });
  }

  async markNotificationPending(
    taskId: string,
    event: "ready" | "terminal",
    entryId: string,
  ): Promise<TaskRecord> {
    const record = this.getTask(taskId);
    const notifications = {
      enabled: record.notifications?.enabled ?? false,
      ready: record.notifications?.ready ?? false,
      terminal: record.notifications?.terminal ?? false,
      outputTailLineCount: record.notifications?.outputTailLineCount ?? 80,
      ...record.notifications,
    };
    return this.updateTask(taskId, {
      notifications:
        event === "ready"
          ? { ...notifications, readyEntryId: entryId }
          : { ...notifications, terminalEntryId: entryId },
    });
  }

  async markNotificationDelivered(
    taskId: string,
    event: "ready" | "terminal",
    entryId: string,
    deliveredAt = new Date().toISOString(),
  ): Promise<TaskRecord> {
    const record = this.getTask(taskId);
    const notifications = {
      enabled: record.notifications?.enabled ?? false,
      ready: record.notifications?.ready ?? false,
      terminal: record.notifications?.terminal ?? false,
      outputTailLineCount: record.notifications?.outputTailLineCount ?? 80,
      ...record.notifications,
    };
    return this.updateTask(taskId, {
      notifications:
        event === "ready"
          ? {
              ...notifications,
              readyEntryId: entryId,
              readyDeliveredAt: deliveredAt,
            }
          : {
              ...notifications,
              terminalEntryId: entryId,
              terminalDeliveredAt: deliveredAt,
            },
    });
  }

  private async envForRestart(
    record: TaskRecord,
  ): Promise<Record<string, string> | undefined> {
    if (!record.envInfo?.persisted) return undefined;

    const config = await this.launchConfigs.read(record.id);
    if (!config) {
      throw new Error(
        "Task was started with persisted env metadata, but launch env is missing; refusing to restart without env.",
      );
    }

    const env = config.env;
    const missingKeys = record.envInfo.keys.filter(
      (key) => !env || !Object.hasOwn(env, key),
    );
    if (missingKeys.length > 0) {
      throw new Error(
        `Task launch env is missing persisted keys (${missingKeys.join(", ")}); refusing to restart without env.`,
      );
    }

    return env ? { ...env } : undefined;
  }

  private async captureOutput(
    taskId: string,
    stream: "stdout" | "stderr",
    chunk: Buffer | string,
  ): Promise<void> {
    const record = this.tasks.get(taskId);
    const managed = this.managed.get(taskId);
    if (!record || !managed) return;
    await this.taskLogs.captureOutput(
      record,
      managed,
      stream,
      chunk,
      async (event) => this.checkReadiness(record.id, event),
    );
  }

  private async flushTaskOutputBuffers(taskId: string): Promise<void> {
    const record = this.tasks.get(taskId);
    const managed = this.managed.get(taskId);
    if (!record || !managed) return;

    try {
      await this.taskLogs.flushOutputBuffers(record, managed, async (event) =>
        this.checkReadiness(record.id, event),
      );
    } catch (error) {
      await this.logger
        ?.warn("Task output flush failed", {
          taskId: record.id,
          projectId: record.projectId,
          conversationId: record.conversationId,
          agentId: record.agentId,
          error,
        })
        .catch(() => undefined);
    }
  }

  private async checkReadiness(
    taskId: string,
    log: TaskLogEvent,
  ): Promise<void> {
    const record = this.tasks.get(taskId);
    const managed = this.managed.get(taskId);
    if (!record || !managed || record.readiness.outcome !== "pending") return;
    const matched = this.taskReadiness.match(
      record,
      managed.readinessPattern,
      log,
    );
    if (!matched) return;
    await this.markTaskReady(taskId, matched);
  }

  private async markTaskReady(taskId: string, matched: string): Promise<void> {
    const record = this.tasks.get(taskId);
    const managed = this.managed.get(taskId);
    if (!record || !managed || record.readiness.outcome !== "pending") return;
    if (record.status === "stopping" || !isActiveTaskStatus(record.status))
      return;
    this.clearReadinessWatch(managed);
    const ready = await this.updateTask(taskId, {
      status: "ready",
      readiness: {
        ...record.readiness,
        outcome: "ready",
        matched,
        readyAt: new Date().toISOString(),
      },
    });
    await this.events.publish("task.ready", { task: ready, matched });
    await this.logger?.info("Task ready", {
      taskId: ready.id,
      projectId: ready.projectId,
      conversationId: ready.conversationId,
      agentId: ready.agentId,
      context: { matched },
    });
  }

  private scheduleReadyUrlPolling(taskId: string): void {
    const record = this.tasks.get(taskId);
    if (!record?.readiness.readyUrl || record.readiness.outcome !== "pending") {
      return;
    }
    const managed = this.managed.get(taskId);
    if (!managed) return;
    managed.readinessPollAbort?.abort();
    const abort = new AbortController();
    managed.readinessPollAbort = abort;
    const readyUrl = record.readiness.readyUrl;
    void this.pollReadyUrl(taskId, readyUrl, abort.signal);
  }

  private async pollReadyUrl(
    taskId: string,
    readyUrl: string,
    signal: AbortSignal,
  ): Promise<void> {
    while (!signal.aborted) {
      const record = this.tasks.get(taskId);
      if (!record || record.readiness.outcome !== "pending") return;
      if (await this.isReadyUrlReachable(readyUrl, signal)) {
        await this.markTaskReady(taskId, readyUrl);
        return;
      }
      try {
        await delay(250, undefined, { signal });
      } catch {
        return;
      }
    }
  }

  private async isReadyUrlReachable(
    readyUrl: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    try {
      await fetch(readyUrl, { method: "GET", signal });
      return true;
    } catch (error) {
      if (signal.aborted) return false;
      if (error instanceof TypeError) return false;
      return false;
    }
  }

  private clearReadinessWatch(managed: ManagedTask | undefined): void {
    if (!managed) return;
    if (managed.readinessTimer) clearTimeout(managed.readinessTimer);
    managed.readinessTimer = undefined;
    managed.readinessPollAbort?.abort();
    managed.readinessPollAbort = undefined;
  }

  private scheduleReadinessTimeout(taskId: string): void {
    const record = this.tasks.get(taskId);
    if (!record || record.readiness.outcome !== "pending") return;
    const managed = this.managed.get(taskId);
    const timeoutMs = record.readiness.timeoutMs ?? 3000;
    if (!managed || timeoutMs <= 0) return;
    if (managed.readinessTimer) clearTimeout(managed.readinessTimer);
    managed.readinessTimer = setTimeout(() => {
      void this.markReadinessTimeout(taskId);
    }, timeoutMs);
  }

  private scheduleRuntimeTimeout(
    taskId: string,
    timeoutMs: number | undefined,
  ): void {
    if (!timeoutMs || timeoutMs <= 0) return;
    const managed = this.managed.get(taskId);
    if (!managed) return;
    if (managed.runtimeTimer) clearTimeout(managed.runtimeTimer);
    managed.runtimeTimer = setTimeout(() => {
      void this.markRuntimeTimeout(taskId, timeoutMs);
    }, timeoutMs);
  }

  private async markReadinessTimeout(taskId: string): Promise<void> {
    const record = this.tasks.get(taskId);
    if (!record || record.readiness.outcome !== "pending") return;
    this.clearReadinessWatch(this.managed.get(taskId));
    const updated = await this.updateTask(taskId, {
      readiness: { ...record.readiness, outcome: "timeout" },
    });
    await this.events.publish("task.ready_timeout", { task: updated });
    await this.logger?.warn("Task readiness timed out", {
      taskId: updated.id,
      projectId: updated.projectId,
      conversationId: updated.conversationId,
      agentId: updated.agentId,
      context: { timeoutMs: updated.readiness.timeoutMs },
    });
  }

  private async markRuntimeTimeout(
    taskId: string,
    timeoutMs: number,
  ): Promise<void> {
    const record = this.tasks.get(taskId);
    const managed = this.managed.get(taskId);
    if (!record || !managed?.child || !isActiveTaskStatus(record.status))
      return;
    managed.timedOut = true;
    this.clearReadinessWatch(managed);
    const error = `Task exceeded maximum runtime of ${timeoutMs}ms.`;
    const stopping = await this.updateTask(taskId, {
      status: "stopping",
      error,
    });
    await this.logger?.warn("Task runtime timed out", {
      taskId: stopping.id,
      projectId: stopping.projectId,
      conversationId: stopping.conversationId,
      agentId: stopping.agentId,
      context: { timeoutMs },
    });
    void this.requestTermination(stopping, managed.child, "SIGTERM", error);
    setTimeout(() => {
      const latest = this.tasks.get(taskId);
      if (!latest || !isActiveTaskStatus(latest.status)) return;
      void this.requestTermination(
        latest,
        managed.child as ChildProcess,
        "SIGKILL",
        error,
      );
      void this.forceFinalizeTimedOutTask(taskId, "SIGKILL", error);
    }, 5000);
  }

  private async requestTermination(
    record: TaskRecord,
    child: ChildProcess,
    signal: NodeJS.Signals,
    reason: string,
  ): Promise<void> {
    try {
      const result = await this.supervisor.terminate(child, signal);
      if (!result.error) return;
      if (this.logger) {
        await this.logger
          .warn("Task termination reported an error", {
            taskId: record.id,
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
          .warn("Task termination failed", {
            taskId: record.id,
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

  private markHydratedRecordOrphaned(record: TaskRecord): TaskRecord {
    return {
      ...record,
      status: "orphaned",
      error: this.orphanedHydrateMessage(record.runtime),
      finishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  private orphanedHydrateMessage(runtime: TaskRuntime | undefined): string {
    if (runtime?.childPid) {
      return `Task supervision was lost after daemon restart. Use task_cancel to attempt cleanup of PID ${runtime.childPid}.`;
    }
    if (runtime?.processGroupId) {
      return `Task supervision was lost after daemon restart. Use task_cancel to attempt cleanup of process group ${runtime.processGroupId}.`;
    }
    return "Task supervision was lost after daemon restart, and no PID metadata was captured.";
  }

  private async cleanupOrphanedTask(
    taskId: string,
    request: CancelTaskRequest,
  ): Promise<TaskRecord> {
    const record = this.getTask(taskId);
    if (record.status !== "orphaned") return record;

    const validationError = this.orphanCleanupValidationError(record.runtime);
    if (validationError) {
      await this.failOrphanCleanup(record, validationError);
    }
    const runtime = record.runtime as TaskRuntime;
    const initialSignal = request.signal ?? "SIGTERM";
    const timeoutMs = request.timeoutMs ?? 5000;

    await this.events.publish("task.stop_requested", {
      taskId: record.id,
      signal: initialSignal,
      orphaned: true,
    });
    await this.logger?.info("Orphaned task cleanup requested", {
      taskId: record.id,
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
          result.error ?? "Could not clean up orphaned task runtime target.",
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
        initialResult.error ?? "Could not signal orphaned task runtime target.",
        { method: initialResult.method, signal: initialSignal },
      );
    }
    if (initialResult.error) {
      await this.logger?.warn(
        "Orphaned task cleanup signal reported an error",
        {
          taskId: record.id,
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
            "Could not force-kill orphaned task runtime target.",
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
    runtime: TaskRuntime | undefined,
  ): string | undefined {
    if (!runtime) {
      return "Cannot clean up orphaned task because no PID metadata was captured.";
    }
    if (runtime.platform !== process.platform) {
      return `Cannot clean up task spawned on ${runtime.platform} from ${process.platform}.`;
    }
    if (runtime.platform === "win32" && !runtime.childPid) {
      return "Cannot clean up orphaned task because no child PID metadata was captured.";
    }
    if (
      runtime.platform !== "win32" &&
      !runtime.processGroupId &&
      !runtime.childPid
    ) {
      return "Cannot clean up orphaned task because no process-group or child PID metadata was captured.";
    }
    return undefined;
  }

  private async terminateRuntimeForCleanup(
    record: TaskRecord,
    runtime: TaskRuntime,
    signal: NodeJS.Signals,
  ) {
    try {
      return await this.supervisor.terminateRuntime(runtime, signal);
    } catch (error) {
      await this.logger?.warn("Orphaned task cleanup termination threw", {
        taskId: record.id,
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
    runtime: TaskRuntime,
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

  private async isRuntimeTargetAlive(runtime: TaskRuntime): Promise<boolean> {
    try {
      return await this.supervisor.isRuntimeTargetAlive(runtime);
    } catch (error) {
      await this.logger?.warn("Orphaned task liveness check failed", {
        error,
        context: this.runtimeLogContext(runtime),
      });
      return true;
    }
  }

  private async finalizeOrphanCleanup(
    taskId: string,
    finalSignal: NodeJS.Signals,
    runtime: TaskRuntime,
    context: Record<string, unknown> = {},
  ): Promise<TaskRecord> {
    const record = this.getTask(taskId);
    if (record.status !== "orphaned") return record;
    const managed = this.managed.get(taskId);
    this.clearReadinessWatch(managed);
    if (managed?.runtimeTimer) clearTimeout(managed.runtimeTimer);

    const readiness =
      record.readiness.outcome === "pending"
        ? { ...record.readiness, outcome: "exited" as const }
        : record.readiness;
    const updated = await this.updateTask(taskId, {
      status: "cancelled",
      readiness,
      finishedAt: new Date().toISOString(),
      exitCode: null,
      signal: finalSignal,
      error: undefined,
    });
    this.managed.delete(taskId);
    await this.events.publish("task.cancelled", { task: updated });
    await this.events.publish("task.orphan_cleanup_succeeded", {
      task: updated,
      runtime,
      signal: finalSignal,
      ...context,
    });
    await this.logger?.info("Orphaned task cleanup completed", {
      taskId: updated.id,
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
    record: TaskRecord,
    message: string,
    context: Record<string, unknown> = {},
  ): Promise<never> {
    const updated = await this.updateTask(record.id, { error: message });
    await this.events.publish("task.cleanup_failed", {
      task: updated,
      error: message,
      orphaned: true,
      ...context,
    });
    await this.logger?.warn("Orphaned task cleanup failed", {
      taskId: updated.id,
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
    runtime: TaskRuntime | undefined,
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

  private async forceFinalizeCancelledTask(
    taskId: string,
    signal: NodeJS.Signals,
    reason: string,
  ): Promise<TaskRecord> {
    const record = this.getTask(taskId);
    if (!isActiveTaskStatus(record.status)) return record;

    const managed = this.managed.get(taskId);
    this.clearReadinessWatch(managed);
    if (managed?.runtimeTimer) clearTimeout(managed.runtimeTimer);
    if (managed) managed.finalized = true;

    await this.flushTaskOutputBuffers(taskId);

    const freshRecord = this.tasks.get(taskId) ?? record;
    const readiness =
      freshRecord.readiness.outcome === "pending"
        ? { ...freshRecord.readiness, outcome: "exited" as const }
        : freshRecord.readiness;
    const updated = await this.updateTask(taskId, {
      status: "cancelled",
      readiness,
      finishedAt: new Date().toISOString(),
      exitCode: null,
      signal,
    });
    this.managed.delete(taskId);
    await this.events.publish("task.cancelled", { task: updated });
    await this.logger?.warn("Task stop force-finalized", {
      taskId: updated.id,
      projectId: updated.projectId,
      conversationId: updated.conversationId,
      agentId: updated.agentId,
      context: { signal, reason },
    });
    return updated;
  }

  private async forceFinalizeTimedOutTask(
    taskId: string,
    signal: NodeJS.Signals,
    reason: string,
  ): Promise<TaskRecord> {
    const record = this.getTask(taskId);
    if (!isActiveTaskStatus(record.status)) return record;

    const managed = this.managed.get(taskId);
    this.clearReadinessWatch(managed);
    if (managed?.runtimeTimer) clearTimeout(managed.runtimeTimer);
    if (managed) managed.finalized = true;

    await this.flushTaskOutputBuffers(taskId);

    const freshRecord = this.tasks.get(taskId) ?? record;
    const readiness =
      freshRecord.readiness.outcome === "pending"
        ? { ...freshRecord.readiness, outcome: "exited" as const }
        : freshRecord.readiness;
    const updated = await this.updateTask(taskId, {
      status: "timed_out",
      readiness,
      finishedAt: new Date().toISOString(),
      exitCode: null,
      signal,
      error: freshRecord.error ?? reason,
    });
    this.managed.delete(taskId);
    await this.events.publish("task.timed_out", { task: updated });
    await this.logger?.warn("Task timeout force-finalized", {
      taskId: updated.id,
      projectId: updated.projectId,
      conversationId: updated.conversationId,
      agentId: updated.agentId,
      context: { signal, reason },
    });
    return updated;
  }

  private async markTaskExited(
    taskId: string,
    exitCode: number | null,
    signal: NodeJS.Signals | null,
  ): Promise<TaskRecord | undefined> {
    const record = this.tasks.get(taskId);
    const managed = this.managed.get(taskId);
    if (!record) return undefined;
    if (!isActiveTaskStatus(record.status)) return record;
    if (managed?.finalized) return record;
    this.clearReadinessWatch(managed);
    if (managed?.runtimeTimer) clearTimeout(managed.runtimeTimer);
    if (managed) managed.finalized = true;

    await this.flushTaskOutputBuffers(taskId);

    const freshRecord = this.tasks.get(taskId);
    if (!freshRecord) return undefined;
    if (!isActiveTaskStatus(freshRecord.status)) return freshRecord;

    const status = managed?.timedOut
      ? "timed_out"
      : managed?.stopping
        ? "cancelled"
        : exitCode === 0
          ? "completed"
          : "failed";
    const readiness =
      freshRecord.readiness.outcome === "pending"
        ? { ...freshRecord.readiness, outcome: "exited" as const }
        : freshRecord.readiness;
    const updated = await this.updateTask(taskId, {
      status,
      readiness,
      finishedAt: new Date().toISOString(),
      exitCode,
      signal,
      error: freshRecord.error,
    });
    this.managed.delete(taskId);
    await this.events.publish(`task.${status}`, { task: updated });
    await this.logger?.[
      status === "failed" || status === "timed_out" ? "error" : "info"
    ]("Task exited", {
      taskId: updated.id,
      projectId: updated.projectId,
      conversationId: updated.conversationId,
      agentId: updated.agentId,
      context: { exitCode, signal, status },
    });
    return updated;
  }

  private async markTaskError(taskId: string, message: string): Promise<void> {
    const record = this.tasks.get(taskId);
    const managed = this.managed.get(taskId);
    if (!record || !isActiveTaskStatus(record.status)) return;
    if (managed?.finalized) return;
    this.clearReadinessWatch(managed);
    if (managed?.runtimeTimer) clearTimeout(managed.runtimeTimer);
    if (managed) managed.finalized = true;

    await this.flushTaskOutputBuffers(taskId);

    const freshRecord = this.tasks.get(taskId);
    if (!freshRecord || !isActiveTaskStatus(freshRecord.status)) return;

    const readiness =
      freshRecord.readiness.outcome === "pending"
        ? { ...freshRecord.readiness, outcome: "exited" as const }
        : freshRecord.readiness;
    const updated = await this.updateTask(taskId, {
      status: "failed",
      readiness,
      finishedAt: new Date().toISOString(),
      error: message,
    });
    this.managed.delete(taskId);
    await this.events.publish("task.failed", { task: updated, message });
    await this.logger?.error("Task error", {
      taskId: updated.id,
      projectId: updated.projectId,
      conversationId: updated.conversationId,
      agentId: updated.agentId,
      context: { message },
    });
  }

  private async updateTask(
    taskId: string,
    patch: Partial<Omit<TaskRecord, "id" | "startedAt">>,
  ): Promise<TaskRecord> {
    const current = this.getTask(taskId);
    const updated: TaskRecord = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await this.upsertTask(updated);
    return updated;
  }

  private async upsertTask(record: TaskRecord): Promise<void> {
    this.tasks.set(record.id, record);
    this.index.upsertTask(record);
    await this.writeTask(record);
  }

  private async writeTask(record: TaskRecord): Promise<void> {
    await this.taskRepository.write(record);
  }

  private taskDir(taskId: string): string {
    return this.taskRepository.taskDir(taskId);
  }
}

function defaultTaskNotificationsEnabled(
  request: StartTaskRequest & {
    origin?: TaskRecord["origin"];
    completion?: TaskRecord["completion"];
  },
): boolean {
  if (request.notify !== undefined) return request.notify;
  if (request.injectCompletion === true || request.completion?.inject === true)
    return true;
  if (request.origin?.kind === "agent_tool") return true;
  return Boolean(request.agentId && request.conversationId);
}

function buildTaskEnvInfo(
  env?: Record<string, string>,
): TaskEnvInfo | undefined {
  const keys = Object.keys(env ?? {})
    .filter((key) => key.length > 0)
    .sort();
  if (keys.length === 0) return undefined;
  return { keys, persisted: true, redacted: true };
}

export { isActiveTaskStatus } from "./index.js";
