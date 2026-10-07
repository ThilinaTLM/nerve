import {
  createHarnessMessage,
  type HarnessMessage,
  type HarnessTaskEvent,
  type HarnessTaskEventDetails,
} from "@nervekit/harness/messages";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import type { EventEnvelope } from "@nervekit/contracts/events";
import type { TaskLogEvent, TaskRecord } from "@nervekit/contracts/tasks";
import { createId } from "@nervekit/contracts";
import type { ApplicationLogger } from "../../../infrastructure/diagnostics/index.js";
import type { StreamLogRegistry } from "../../../infrastructure/events/index.js";
import type { WorkbenchTaskService } from "../adapters/workbench-task-service.js";
import {
  formatTaskEventSummary,
  relevantFailureLogs,
  taskCommandDisplay,
  taskCommandPreview,
  taskOutputDisplay,
} from "../model/task-summary-format.js";

export interface TaskNotificationServiceDeps {
  tasks: WorkbenchTaskService;
  events: StreamLogRegistry;
  getConversationEntries(conversationId: string): Promise<ConversationEntry[]>;
  /** Acceptance is durable, but is not a context-delivery receipt. */
  enqueueNotification(input: {
    task: TaskRecord;
    event: HarnessTaskEvent;
    message: HarnessMessage;
    entryId: string;
    timestamp: string;
  }): Promise<void>;
  logger?: ApplicationLogger;
  allowNotification?(task: TaskRecord): Promise<boolean>;
}

type NotificationSlot = "ready" | "terminal";

const TERMINAL_TASK_EVENTS = new Map<string, HarnessTaskEvent>([
  ["task.completed", "completed"],
  ["task.failed", "failed"],
  ["task.timed_out", "timed_out"],
  ["task.cancelled", "cancelled"],
  ["task.orphaned", "orphaned"],
  ["task.interrupted", "interrupted"],
  ["task.recovery_unknown", "recovery_unknown"],
]);

export class TaskNotificationService {
  private unsubscribe?: () => void;
  private stopped = false;
  private readonly pendingOperations = new Set<Promise<void>>();
  private readonly delivering = new Set<string>();
  private readonly readyTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly deps: TaskNotificationServiceDeps) {}

  start(): void {
    this.stopped = false;
    this.unsubscribe ??= this.deps.events.subscribe((event) => {
      void this.track(
        this.handleEvent(event).catch((error) =>
          this.deps.logger?.warn("Task notification event handling failed", {
            error,
          }),
        ),
      );
    });
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const timer of this.readyTimers.values()) clearTimeout(timer);
    this.readyTimers.clear();
  }

  async settled(): Promise<void> {
    while (this.pendingOperations.size)
      await Promise.allSettled([...this.pendingOperations]);
  }

  private track(operation: Promise<void>): Promise<void> {
    this.pendingOperations.add(operation);
    const release = () => this.pendingOperations.delete(operation);
    void operation.then(release, release);
    return operation;
  }

  private async handleEvent(event: EventEnvelope): Promise<void> {
    if (this.stopped) return;
    if (event.type === "conversation.entry.appended") {
      const data = event.data as { entry?: ConversationEntry } | undefined;
      if (data?.entry) await this.markDeliveredFromEntry(data.entry);
      return;
    }

    if (event.type === "run.completed" || event.type === "run.failed") {
      await this.recoverPendingNotifications();
      return;
    }

    if (event.type === "task.ready" || event.type === "task.timed_out") {
      const data = event.data as { task?: TaskRecord } | undefined;
      const task = data?.task;
      if (!task) return;
      this.scheduleReadyNotification(
        task,
        event.type === "task.ready" ? "ready" : "ready_timeout",
      );
      return;
    }

    const terminalEvent = TERMINAL_TASK_EVENTS.get(event.type);
    if (!terminalEvent) return;
    const data = event.data as { task?: TaskRecord } | undefined;
    const task = data?.task;
    if (!task) return;
    const readyTimer = this.readyTimers.get(task.id);
    if (readyTimer) {
      clearTimeout(readyTimer);
      this.readyTimers.delete(task.id);
    }
    await this.deliverNotification(task, terminalEvent).catch((error) =>
      this.deps.logger?.warn("Task terminal notification failed", {
        taskId: task.id,
        projectId: task.projectId,
        conversationId: task.conversationId,
        agentId: task.agentId,
        error,
      }),
    );
  }

  private scheduleReadyNotification(
    task: TaskRecord,
    event: Extract<HarnessTaskEvent, "ready" | "ready_timeout">,
  ): void {
    const existing = this.readyTimers.get(task.id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.readyTimers.delete(task.id);
      if (this.stopped) return;
      void this.track(
        this.deliverNotification(task, event).catch((error) =>
          this.deps.logger?.warn("Task ready notification failed", {
            taskId: task.id,
            projectId: task.projectId,
            conversationId: task.conversationId,
            agentId: task.agentId,
            error,
          }),
        ),
      );
    }, 500);
    this.readyTimers.set(task.id, timer);
  }

  recoverPendingNotifications(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return this.track(this.performRecovery());
  }

  private async performRecovery(): Promise<void> {
    for (const task of this.deps.tasks.listTasks()) {
      if (this.stopped) return;
      if (task.notifications?.enabled !== true) continue;
      const readinessEvent = readinessEventForTask(task);
      if (
        readinessEvent &&
        task.notifications.ready === true &&
        !task.notifications.readyDeliveredAt &&
        (task.status === "ready" || task.status === "running")
      ) {
        await this.deliverNotification(task, readinessEvent).catch((error) =>
          this.deps.logger?.warn(
            "Task readiness notification recovery failed",
            {
              taskId: task.id,
              error,
            },
          ),
        );
      }
      const terminalEvent = terminalEventForTask(task);
      if (
        terminalEvent &&
        task.notifications.terminal === true &&
        !task.notifications.terminalDeliveredAt
      ) {
        await this.deliverNotification(task, terminalEvent).catch((error) =>
          this.deps.logger?.warn("Task terminal notification recovery failed", {
            taskId: task.id,
            error,
          }),
        );
      }
    }
  }

  private async deliverNotification(
    taskSnapshot: TaskRecord,
    event: HarnessTaskEvent,
  ): Promise<void> {
    const slot = slotForEvent(event);
    const key = `${taskSnapshot.id}:${slot}`;
    if (this.delivering.has(key)) return;
    this.delivering.add(key);
    try {
      let task: TaskRecord;
      try {
        task = this.deps.tasks.getTask(taskSnapshot.id);
      } catch {
        // Foreground tasks may be removed before a delayed notice fires.
        return;
      }
      if (!this.shouldDeliver(task, event)) return;
      if (
        this.deps.allowNotification &&
        !(await this.deps.allowNotification(task))
      )
        return;

      // Only legacy/UI notices use transcript entries as delivery evidence.
      // Agent notices are acknowledged by the common input delivery receipt.
      if (!task.agentId) {
        const existing = await this.findExistingTaskEventEntry(task, event);
        if (existing) {
          await this.deps.tasks.markNotificationDelivered(
            task.id,
            slot,
            existing.id,
            existing.createdAt,
          );
          return;
        }
      }
      const currentEntryId =
        slot === "ready"
          ? task.notifications?.readyEntryId
          : task.notifications?.terminalEntryId;
      const entryId = currentEntryId ?? createId("entry");
      if (!currentEntryId) {
        await this.deps.tasks.markNotificationPending(task.id, slot, entryId);
      }
      const timestamp = new Date().toISOString();
      const { message } = await this.buildHarnessMessage(
        task,
        event,
        entryId,
        timestamp,
      );
      await this.deps.enqueueNotification({
        task,
        event,
        message,
        entryId,
        timestamp,
      });
      if (!task.agentId) {
        await this.deps.tasks.markNotificationDelivered(
          task.id,
          slot,
          entryId,
          timestamp,
        );
      }
      // No direct harness injection, append, or wake on acceptance. Recovery
      // retries with the same slot identity until the adapter observes delivery.
    } finally {
      this.delivering.delete(key);
    }
  }

  private shouldDeliver(task: TaskRecord, event: HarnessTaskEvent): boolean {
    const notifications = task.notifications;
    if (notifications?.enabled !== true) return false;
    if (!task.conversationId) return false;
    if (event === "ready" || event === "ready_timeout") {
      return notifications.ready === true && !notifications.readyDeliveredAt;
    }
    return (
      notifications.terminal === true && !notifications.terminalDeliveredAt
    );
  }

  private async buildHarnessMessage(
    task: TaskRecord,
    event: HarnessTaskEvent,
    entryId: string,
    timestamp: string,
  ): Promise<{
    message: HarnessMessage<HarnessTaskEventDetails>;
    nextCursor?: number;
  }> {
    const logs = await this.logsForEvent(task, event);
    const text = formatTaskEventSummary({
      task,
      event,
      logs: logs.events,
      nextCursor: logs.nextCursor,
    });
    const details: HarnessTaskEventDetails = {
      taskId: task.id,
      taskName: task.name,
      groupId: task.groupId,
      groupName: task.groupName,
      event,
      status: task.status,
      readiness: task.readiness,
      exitCode: task.exitCode ?? null,
      signal: task.signal ?? null,
      nextCursor: logs.nextCursor,
      commandPreview: taskCommandPreview(task),
      command: taskCommandDisplay(task),
      output: taskOutputDisplay(logs.events),
      notificationEntryId: entryId,
    };
    return {
      message: createHarnessMessage("task_event", text, details, timestamp),
      nextCursor: logs.nextCursor,
    };
  }

  private async logsForEvent(
    task: TaskRecord,
    event: HarnessTaskEvent,
  ): Promise<{ events: TaskLogEvent[]; nextCursor?: number }> {
    if (event === "ready") {
      const cursor = await this.deps.tasks.queryLogs(task.id, {
        mode: "recent",
        limit: 1,
      });
      return { events: [], nextCursor: cursor.nextCursor };
    }
    if (event === "ready_timeout") {
      const recent = await this.deps.tasks.queryLogs(task.id, {
        mode: "recent",
        limit: Math.min(task.notifications?.outputTailLineCount ?? 3, 3),
      });
      return { events: recent.events, nextCursor: recent.nextCursor };
    }
    if (event === "failed" || event === "timed_out") {
      const [firstFailure, errors, warnings, recent] = await Promise.all([
        this.deps.tasks.queryLogs(task.id, {
          mode: "first_failure",
          contextLines: 2,
          limit: 12,
        }),
        this.deps.tasks.queryLogs(task.id, { mode: "errors", limit: 12 }),
        this.deps.tasks.queryLogs(task.id, { mode: "warnings", limit: 12 }),
        this.deps.tasks.queryLogs(task.id, { mode: "recent", limit: 12 }),
      ]);
      return relevantFailureLogs(
        [firstFailure, errors, warnings, recent],
        Math.min(task.notifications?.outputTailLineCount ?? 12, 12),
      );
    }
    const recent = await this.deps.tasks.queryLogs(task.id, {
      mode: "recent",
      limit: Math.min(task.notifications?.outputTailLineCount ?? 3, 3),
    });
    return { events: recent.events, nextCursor: recent.nextCursor };
  }

  private async markDeliveredFromEntry(
    entry: ConversationEntry,
  ): Promise<void> {
    if (entry.kind !== "task_event") return;
    const details = asRecord(entry.details);
    if (details?.type !== "task_event") return;
    const taskId = stringValue(details.taskId);
    const event = taskEventValue(details.event);
    if (!taskId || !event) return;
    try {
      // Agent-owned delivery is exclusively acknowledged by the queue adapter.
      if (this.deps.tasks.getTask(taskId).agentId) return;
    } catch {
      return;
    }
    await this.deps.tasks.markNotificationDelivered(
      taskId,
      slotForEvent(event),
      entry.id,
      entry.createdAt,
    );
  }

  private async findExistingTaskEventEntry(
    task: TaskRecord,
    event: HarnessTaskEvent,
  ): Promise<ConversationEntry | undefined> {
    if (!task.conversationId) return undefined;
    return (await this.deps.getConversationEntries(task.conversationId)).find(
      (entry) => {
        if (entry.kind !== "task_event") return false;
        const details = asRecord(entry.details);
        return (
          details?.type === "task_event" &&
          details.taskId === task.id &&
          details.event === event
        );
      },
    );
  }
}

function slotForEvent(event: HarnessTaskEvent): NotificationSlot {
  return event === "ready" || event === "ready_timeout" ? "ready" : "terminal";
}

function readinessEventForTask(task: TaskRecord): HarnessTaskEvent | undefined {
  if (task.readiness.outcome === "ready") return "ready";
  if (task.readiness.outcome === "timeout") return "ready_timeout";
  return undefined;
}

function terminalEventForTask(task: TaskRecord): HarnessTaskEvent | undefined {
  switch (task.status) {
    case "completed":
    case "failed":
    case "timed_out":
    case "cancelled":
    case "orphaned":
    case "interrupted":
    case "recovery_unknown":
      return task.status;
    default:
      return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function taskEventValue(value: unknown): HarnessTaskEvent | undefined {
  return value === "ready" ||
    value === "ready_timeout" ||
    value === "completed" ||
    value === "failed" ||
    value === "timed_out" ||
    value === "cancelled" ||
    value === "orphaned" ||
    value === "interrupted" ||
    value === "recovery_unknown"
    ? value
    : undefined;
}
