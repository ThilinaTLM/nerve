import type { ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { TaskService } from "@nervekit/host-runtime";
import type {
  ToolExecutionOutputUpdate,
  ToolExecutionResult,
} from "@nervekit/host-runtime/tools";
import {
  type CancelTaskRequest,
  createId,
  type StartTaskRequest,
  type TaskListeningPort,
  type TaskLogQuery,
  type TaskLogQueryResponse,
  type TaskRecord,
  type TaskRuntime,
} from "@nervekit/contracts";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { IndexStore } from "../../infrastructure/index-store/index.js";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";
import {
  isActiveTaskStatus,
  type TaskLogCursor,
  TaskLogService,
  TaskRepository,
  type TaskSupervisor,
} from "./index.js";
import type { LegacyProcessRecord } from "./task.repository.js";
import type { TaskLaunchConfigStore } from "./task-launch-config.store.js";
import {
  buildForegroundBashResult as buildForegroundBashResultImpl,
  runForegroundBashWithPromotion as runForegroundBashWithPromotionImpl,
} from "./workbench-task-service-foreground.js";
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
} from "./workbench-task-service-orphan.js";
import { createWorkbenchTaskResources } from "./workbench-task-adapters.js";

export interface WorkbenchTaskServiceOptions {
  supervisor?: TaskSupervisor;
  launchConfigs?: TaskLaunchConfigStore;
}

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

export class WorkbenchTaskService extends TaskService {
  readonly tasks: Map<string, TaskRecord>;
  readonly managed: Map<string, ManagedTask>;
  readonly taskRepository: TaskRepository;
  readonly taskLogs: TaskLogService;
  readonly supervisor: TaskSupervisor;
  readonly launchConfigs: TaskLaunchConfigStore;

  constructor(
    readonly storage: InitializedStorage,
    readonly events: EventBus,
    readonly index: IndexStore,
    readonly logger?: ApplicationLogger,
    options: WorkbenchTaskServiceOptions = {},
  ) {
    const resources = createWorkbenchTaskResources(
      storage,
      events,
      index,
      logger,
      options,
    );
    super(resources.ports);
    this.tasks = resources.tasks;
    this.managed = resources.managed;
    this.supervisor = resources.supervisor;
    this.launchConfigs = resources.launchConfigs;
    this.taskRepository = resources.repository;
    this.taskLogs = resources.logs;
  }

  async hydrate(): Promise<void> {
    for (const persisted of await this.taskRepository.hydrate())
      await this.upsertTask(persisted);
    await this.reconcileOrphans();
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
    return this.start({
      ...request,
      notifications:
        request.notify === undefined
          ? request.conversationId
            ? {
                enabled: true,
                ready: true,
                terminal: true,
                outputTailLineCount: 80,
              }
            : undefined
          : {
              enabled: request.notify,
              ready: request.notify,
              terminal: request.notify,
              outputTailLineCount: 80,
            },
      completion:
        request.completion ??
        (request.injectCompletion !== undefined
          ? {
              inject: request.injectCompletion,
              outputTailLineCount: 80,
            }
          : undefined),
    });
  }
  async cancelTask(
    taskId: string,
    request: CancelTaskRequest = {},
  ): Promise<TaskRecord> {
    const record = this.getTask(taskId);
    if (record.status === "orphaned")
      return this.cleanupOrphanedTask(record.id, request);
    if (this.managed.get(taskId)?.stopping) return record;
    return this.cancel(taskId, request);
  }

  async restartTask(taskId: string): Promise<TaskRecord> {
    const record = this.getTask(taskId);
    if (record.status === "orphaned") {
      await this.envForRestart(record);
      await this.cleanupOrphanedTask(record.id, { timeoutMs: 5000 });
    }
    return this.restart(taskId);
  }

  async removeTask(taskId: string): Promise<void> {
    await this.delete(taskId);
  }

  async pruneTasks(): Promise<string[]> {
    return this.prune();
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
    return this.logs(taskId, query);
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

  clearReadinessWatch(managed: ManagedTask | undefined): void {
    if (managed?.readinessTimer) clearTimeout(managed.readinessTimer);
    managed?.readinessPollAbort?.abort();
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
