import type { ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type CancelTaskRequest,
  createId,
  type StartTaskRequest,
  type TaskListeningPort,
  type TaskLogEvent,
  type TaskLogQuery,
  type TaskLogQueryResponse,
  type TaskRecord,
  type TaskRuntime,
} from "@nervekit/shared";
import type {
  ToolExecutionOutputUpdate,
  ToolExecutionResult,
} from "@nervekit/tools";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { IndexStore } from "../../infrastructure/index-store/index.js";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";
import {
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
import {
  forceFinalizeCancelledTask as forceFinalizeCancelledTaskImpl,
  forceFinalizeTimedOutTask as forceFinalizeTimedOutTaskImpl,
  markTaskError as markTaskErrorImpl,
  markTaskExited as markTaskExitedImpl,
  resolveManagedTerminal as resolveManagedTerminalImpl,
} from "./task-manager-finalization.js";
import {
  buildForegroundBashResult as buildForegroundBashResultImpl,
  runForegroundBashWithPromotion as runForegroundBashWithPromotionImpl,
} from "./task-manager-foreground.js";
import {
  cleanupOrphanedTask as cleanupOrphanedTaskImpl,
  errorMessage as errorMessageImpl,
  failOrphanCleanup as failOrphanCleanupImpl,
  finalizeOrphanCleanup as finalizeOrphanCleanupImpl,
  inspectPortListenersForCleanup as inspectPortListenersForCleanupImpl,
  isRuntimeTargetAlive as isRuntimeTargetAliveImpl,
  listeningPortsForOrphanCleanup as listeningPortsForOrphanCleanupImpl,
  markHydratedRecordOrphaned as markHydratedRecordOrphanedImpl,
  orphanCleanupValidationError as orphanCleanupValidationErrorImpl,
  orphanedHydrateMessage as orphanedHydrateMessageImpl,
  releaseOrphanedListeningPorts as releaseOrphanedListeningPortsImpl,
  runtimeLogContext as runtimeLogContextImpl,
  terminateRuntimeForCleanup as terminateRuntimeForCleanupImpl,
  waitForRuntimeTargetExit as waitForRuntimeTargetExitImpl,
} from "./task-manager-orphan.js";
import {
  captureOutput as captureOutputImpl,
  checkReadiness as checkReadinessImpl,
  clearReadinessWatch as clearReadinessWatchImpl,
  flushTaskOutputBuffers as flushTaskOutputBuffersImpl,
  isReadyUrlReachable as isReadyUrlReachableImpl,
  markReadinessTimeout as markReadinessTimeoutImpl,
  markRuntimeTimeout as markRuntimeTimeoutImpl,
  markTaskReady as markTaskReadyImpl,
  pollReadyUrl as pollReadyUrlImpl,
  requestTermination as requestTerminationImpl,
  scheduleReadinessTimeout as scheduleReadinessTimeoutImpl,
  scheduleReadyUrlPolling as scheduleReadyUrlPollingImpl,
  scheduleRuntimeTimeout as scheduleRuntimeTimeoutImpl,
} from "./task-manager-output-readiness.js";
import { restartActiveTaskInPlace as restartActiveTaskInPlaceImpl } from "./task-manager-restart.js";
import { startTask as startTaskImpl } from "./task-manager-start.js";

export interface TaskManagerOptions {
  supervisor?: TaskSupervisor;
  launchConfigs?: TaskLaunchConfigStore;
}

const _RUNTIME_TIMEOUT_FORCE_KILL_AFTER_MS = 5000;
const _FOREGROUND_TIMEOUT_RESULT_GRACE_MS = 500;

export type ForegroundBashPromotionInput = {
  command: string;
  cwd: string;
  workerId?: string;
  projectId: string;
  conversationId: string;
  agentId: string;
  timeoutMs?: number;
  autoPromoteAfterMs: number;
  origin: Extract<TaskRecord["origin"], { kind: "agent_tool" }>;
  signal?: AbortSignal;
  onOutput?: (update: ToolExecutionOutputUpdate) => void;
  continueAfterPromotion?: boolean;
};

export type ForegroundBashPromotionResult =
  | { kind: "completed_foreground"; result: ToolExecutionResult }
  | {
      kind: "promoted";
      task: TaskRecord;
      result: ToolExecutionResult;
      elapsedMs: number;
    };

export interface ManagedTask extends TaskLogCursor {
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
  onOutput?: (update: ToolExecutionOutputUpdate) => void;
}

export class TaskManager {
  readonly tasks = new Map<string, TaskRecord>();
  readonly managed = new Map<string, ManagedTask>();
  readonly taskRepository: TaskRepository;
  readonly taskLogs: TaskLogService;
  readonly taskReadiness = new TaskReadinessService();
  readonly supervisor: TaskSupervisor;
  readonly launchConfigs: TaskLaunchConfigStore;

  constructor(
    readonly storage: InitializedStorage,
    readonly events: EventBus,
    readonly index: IndexStore,
    readonly logger?: ApplicationLogger,
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

  async migrateLegacyProcesses(): Promise<void> {
    for (const legacy of await this.taskRepository.hydrateLegacyProcesses()) {
      if (this.findTaskByLegacyProcessId(legacy.id)) continue;
      const record = this.legacyProcessToTask(legacy);
      await mkdir(this.taskDir(record.id), { recursive: true, mode: 0o755 });
      await this.upsertTask(record);
      await this.events.publish("task.orphaned", { task: record });
    }
  }

  findTaskByLegacyProcessId(processId: string): TaskRecord | undefined {
    return [...this.tasks.values()].find(
      (task) => task.legacyProcessId === processId,
    );
  }

  legacyProcessToTask(legacy: LegacyProcessRecord): TaskRecord {
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
      onOutput?: (update: ToolExecutionOutputUpdate) => void;
    },
  ): Promise<TaskRecord> {
    return await startTaskImpl.call(this, request);
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
    if (
      isActiveTaskStatus(record.status) &&
      this.managed.get(record.id)?.child
    ) {
      return await this.restartActiveTaskInPlace(record, env);
    }
    if (record.status === "orphaned") {
      await this.cleanupOrphanedTask(record.id, { timeoutMs: 5000 });
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

  async restartActiveTaskInPlace(
    record: TaskRecord,
    env: Record<string, string> | undefined,
  ): Promise<TaskRecord> {
    return await restartActiveTaskInPlaceImpl.call(this, record, env);
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

  async buildForegroundBashResult(
    taskId: string,
  ): Promise<ToolExecutionResult> {
    return await buildForegroundBashResultImpl.call(this, taskId);
  }
  async runForegroundBashWithPromotion(
    input: ForegroundBashPromotionInput,
  ): Promise<ForegroundBashPromotionResult> {
    return await runForegroundBashWithPromotionImpl.call(this, input);
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

  async envForRestart(
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

  async captureOutput(
    taskId: string,
    stream: "stdout" | "stderr",
    chunk: Buffer | string,
  ): Promise<void> {
    return await captureOutputImpl.call(this, taskId, stream, chunk);
  }
  async flushTaskOutputBuffers(taskId: string): Promise<void> {
    return await flushTaskOutputBuffersImpl.call(this, taskId);
  }
  async checkReadiness(taskId: string, log: TaskLogEvent): Promise<void> {
    return await checkReadinessImpl.call(this, taskId, log);
  }
  async markTaskReady(taskId: string, matched: string): Promise<void> {
    return await markTaskReadyImpl.call(this, taskId, matched);
  }
  scheduleReadyUrlPolling(taskId: string): void {
    scheduleReadyUrlPollingImpl.call(this, taskId);
  }
  async pollReadyUrl(
    taskId: string,
    readyUrl: string,
    signal: AbortSignal,
  ): Promise<void> {
    return await pollReadyUrlImpl.call(this, taskId, readyUrl, signal);
  }
  async isReadyUrlReachable(
    readyUrl: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    return await isReadyUrlReachableImpl.call(this, readyUrl, signal);
  }
  clearReadinessWatch(managed: ManagedTask | undefined): void {
    clearReadinessWatchImpl.call(this, managed);
  }
  scheduleReadinessTimeout(taskId: string): void {
    scheduleReadinessTimeoutImpl.call(this, taskId);
  }
  scheduleRuntimeTimeout(taskId: string, timeoutMs: number | undefined): void {
    scheduleRuntimeTimeoutImpl.call(this, taskId, timeoutMs);
  }
  async markReadinessTimeout(taskId: string): Promise<void> {
    return await markReadinessTimeoutImpl.call(this, taskId);
  }
  async markRuntimeTimeout(taskId: string, timeoutMs: number): Promise<void> {
    return await markRuntimeTimeoutImpl.call(this, taskId, timeoutMs);
  }
  async requestTermination(
    record: TaskRecord,
    child: ChildProcess,
    signal: NodeJS.Signals,
    reason: string,
  ): Promise<void> {
    return await requestTerminationImpl.call(
      this,
      record,
      child,
      signal,
      reason,
    );
  }
  markHydratedRecordOrphaned(record: TaskRecord): TaskRecord {
    return markHydratedRecordOrphanedImpl.call(this, record);
  }

  orphanedHydrateMessage(runtime: TaskRuntime | undefined): string {
    return orphanedHydrateMessageImpl.call(this, runtime);
  }

  async cleanupOrphanedTask(
    taskId: string,
    request: CancelTaskRequest,
  ): Promise<TaskRecord> {
    return await cleanupOrphanedTaskImpl.call(this, taskId, request);
  }

  orphanCleanupValidationError(
    runtime: TaskRuntime | undefined,
  ): string | undefined {
    return orphanCleanupValidationErrorImpl.call(this, runtime);
  }

  async terminateRuntimeForCleanup(
    record: TaskRecord,
    runtime: TaskRuntime,
    signal: NodeJS.Signals,
  ) {
    return await terminateRuntimeForCleanupImpl.call(
      this,
      record,
      runtime,
      signal,
    );
  }

  async waitForRuntimeTargetExit(
    runtime: TaskRuntime,
    timeoutMs: number,
  ): Promise<boolean> {
    return await waitForRuntimeTargetExitImpl.call(this, runtime, timeoutMs);
  }

  async listeningPortsForOrphanCleanup(
    record: TaskRecord,
    runtime: TaskRuntime,
  ): Promise<TaskListeningPort[]> {
    return await listeningPortsForOrphanCleanupImpl.call(this, record, runtime);
  }

  async releaseOrphanedListeningPorts(
    record: TaskRecord,
    cleanupPorts: TaskListeningPort[],
  ): Promise<TaskListeningPort[]> {
    return await releaseOrphanedListeningPortsImpl.call(
      this,
      record,
      cleanupPorts,
    );
  }

  async inspectPortListenersForCleanup(
    record: TaskRecord,
    cleanupPorts: TaskListeningPort[],
  ): Promise<TaskListeningPort[]> {
    return await inspectPortListenersForCleanupImpl.call(
      this,
      record,
      cleanupPorts,
    );
  }

  async isRuntimeTargetAlive(runtime: TaskRuntime): Promise<boolean> {
    return await isRuntimeTargetAliveImpl.call(this, runtime);
  }

  async finalizeOrphanCleanup(
    taskId: string,
    finalSignal: NodeJS.Signals,
    runtime: TaskRuntime,
    context: Record<string, unknown> = {},
  ): Promise<TaskRecord> {
    return await finalizeOrphanCleanupImpl.call(
      this,
      taskId,
      finalSignal,
      runtime,
      context,
    );
  }

  async failOrphanCleanup(
    record: TaskRecord,
    message: string,
    context: Record<string, unknown> = {},
  ): Promise<never> {
    return await failOrphanCleanupImpl.call(this, record, message, context);
  }

  runtimeLogContext(
    runtime: TaskRuntime | undefined,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return runtimeLogContextImpl.call(this, runtime, extra);
  }

  errorMessage(error: unknown): string {
    return errorMessageImpl.call(this, error);
  }

  async forceFinalizeCancelledTask(
    taskId: string,
    signal: NodeJS.Signals,
    reason: string,
  ): Promise<TaskRecord> {
    return await forceFinalizeCancelledTaskImpl.call(
      this,
      taskId,
      signal,
      reason,
    );
  }
  async forceFinalizeTimedOutTask(
    taskId: string,
    signal: NodeJS.Signals,
    reason: string,
  ): Promise<TaskRecord> {
    return await forceFinalizeTimedOutTaskImpl.call(
      this,
      taskId,
      signal,
      reason,
    );
  }
  async markTaskExited(
    taskId: string,
    exitCode: number | null,
    signal: NodeJS.Signals | null,
  ): Promise<TaskRecord | undefined> {
    return await markTaskExitedImpl.call(this, taskId, exitCode, signal);
  }
  async markTaskError(taskId: string, message: string): Promise<void> {
    return await markTaskErrorImpl.call(this, taskId, message);
  }
  resolveManagedTerminal(taskId: string, task: TaskRecord | undefined): void {
    resolveManagedTerminalImpl.call(this, taskId, task);
  }
  async updateTask(
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

  async upsertTask(record: TaskRecord): Promise<void> {
    this.tasks.set(record.id, record);
    this.index.upsertTask(record);
    await this.writeTask(record);
  }

  async writeTask(record: TaskRecord): Promise<void> {
    await this.taskRepository.write(record);
  }

  taskDir(taskId: string): string {
    return this.taskRepository.taskDir(taskId);
  }
}

export { isActiveTaskStatus } from "./index.js";
