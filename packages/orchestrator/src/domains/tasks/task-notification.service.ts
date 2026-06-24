import {
  createHarnessMessage,
  type HarnessMessage,
  type HarnessTaskEvent,
  type HarnessTaskEventDetails,
} from "@nervekit/agent";
import type {
  AgentRecord,
  ConversationEntry,
  EventEnvelope,
  TaskLogEvent,
  TaskRecord,
} from "@nervekit/shared";
import { createId } from "@nervekit/shared";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { ApplicationLogger } from "../../logging.js";
import type { AppendEntryInput } from "../../registry/types.js";
import type { AgentRunStateMap } from "../agents/run/run-state.js";
import type { HarnessManager } from "../conversations/harness-manager.js";
import type { TaskManager } from "./task-manager.js";
import {
  formatTaskEventSummary,
  relevantFailureLogs,
  taskCommandPreview,
} from "./task-summary-format.js";

export interface TaskNotificationServiceDeps {
  tasks: TaskManager;
  events: EventBus;
  runs: AgentRunStateMap;
  appendEntry(
    input: AppendEntryInput,
    options?: { mirrorToHarness?: boolean },
  ): Promise<ConversationEntry>;
  harnessManager: HarnessManager;
  getAgent(agentId: string): AgentRecord;
  getConversationEntries(conversationId: string): ConversationEntry[];
  continueAgent?: (agentId: string) => Promise<void>;
  logger?: ApplicationLogger;
}

type NotificationSlot = "ready" | "terminal";

const TERMINAL_TASK_EVENTS = new Map<string, HarnessTaskEvent>([
  ["task.completed", "completed"],
  ["task.failed", "failed"],
  ["task.timed_out", "timed_out"],
  ["task.cancelled", "cancelled"],
  ["task.orphaned", "orphaned"],
]);

export class TaskNotificationService {
  private unsubscribe?: () => void;
  private readonly delivering = new Set<string>();
  private readonly readyTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly deps: TaskNotificationServiceDeps) {}

  start(): void {
    this.unsubscribe ??= this.deps.events.subscribe((event) => {
      void this.handleEvent(event);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const timer of this.readyTimers.values()) clearTimeout(timer);
    this.readyTimers.clear();
  }

  private async handleEvent(event: EventEnvelope): Promise<void> {
    if (event.type === "conversation.entry.appended") {
      const data = event.data as { entry?: ConversationEntry } | undefined;
      if (data?.entry) await this.markDeliveredFromEntry(data.entry);
      return;
    }

    if (
      event.type === "conversation.run.completed" ||
      event.type === "conversation.run.failed"
    ) {
      await this.recoverPendingNotifications();
      return;
    }

    if (event.type === "task.ready" || event.type === "task.ready_timeout") {
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
      void this.deliverNotification(task, event).catch((error) =>
        this.deps.logger?.warn("Task ready notification failed", {
          taskId: task.id,
          projectId: task.projectId,
          conversationId: task.conversationId,
          agentId: task.agentId,
          error,
        }),
      );
    }, 500);
    this.readyTimers.set(task.id, timer);
  }

  async recoverPendingNotifications(): Promise<void> {
    for (const task of this.deps.tasks.listTasks()) {
      if (task.notifications?.enabled !== true) continue;
      const readinessEvent = readinessEventForTask(task);
      if (
        readinessEvent &&
        task.notifications.ready === true &&
        !task.notifications.readyDeliveredAt &&
        (task.status === "ready" || task.status === "running")
      ) {
        await this.recoverNotification(task, readinessEvent).catch((error) =>
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
        await this.recoverNotification(task, terminalEvent).catch((error) =>
          this.deps.logger?.warn("Task terminal notification recovery failed", {
            taskId: task.id,
            error,
          }),
        );
      }
    }
  }

  private async recoverNotification(
    task: TaskRecord,
    event: HarnessTaskEvent,
  ): Promise<void> {
    const existing = this.findExistingTaskEventEntry(task, event);
    if (existing) {
      await this.deps.tasks.markNotificationDelivered(
        task.id,
        slotForEvent(event),
        existing.id,
        existing.createdAt,
      );
      await this.maybeContinueAwaitedTask(task, event);
      return;
    }
    await this.deliverNotification(task, event);
  }

  private async deliverNotification(
    taskSnapshot: TaskRecord,
    event: HarnessTaskEvent,
  ): Promise<void> {
    const key = `${taskSnapshot.id}:${event}`;
    if (this.delivering.has(key)) return;
    this.delivering.add(key);
    try {
      const task = this.deps.tasks.getTask(taskSnapshot.id);
      if (!this.shouldDeliver(task, event)) return;
      const existing = this.findExistingTaskEventEntry(task, event);
      if (existing) {
        await this.deps.tasks.markNotificationDelivered(
          task.id,
          slotForEvent(event),
          existing.id,
          existing.createdAt,
        );
        await this.maybeContinueAwaitedTask(task, event);
        return;
      }

      const slot = slotForEvent(event);
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

      const activeRun = task.agentId
        ? this.deps.runs.get(task.agentId)
        : undefined;
      if (activeRun?.enqueueHarnessMessage) {
        try {
          await activeRun.enqueueHarnessMessage({
            id: entryId,
            message,
            timestamp,
            delivery: {
              taskId: task.id,
              event,
              pendingNotificationId: entryId,
            },
          });
          return;
        } catch (error) {
          await this.deps.logger?.warn(
            "Active run rejected task notification; appending directly",
            {
              taskId: task.id,
              agentId: task.agentId,
              conversationId: task.conversationId,
              error,
            },
          );
        }
      }

      await this.appendNotificationDirectly(task, entryId, message, timestamp);
      await this.maybeContinueAwaitedTask(task, event);
    } finally {
      this.delivering.delete(key);
    }
  }

  private async maybeContinueAwaitedTask(
    task: TaskRecord,
    event: HarnessTaskEvent,
  ): Promise<void> {
    if (slotForEvent(event) !== "terminal") return;
    if (task.completion?.inject !== true) return;
    if (!task.agentId) return;
    if (this.deps.runs.get(task.agentId)) return;
    const continueAgent = this.deps.continueAgent;
    if (!continueAgent) return;
    const agent = this.deps.getAgent(task.agentId);
    if (agent.status !== "idle") return;
    await continueAgent(task.agentId).catch((error) =>
      this.deps.logger?.warn("Awaited task continuation failed", {
        taskId: task.id,
        agentId: task.agentId,
        conversationId: task.conversationId,
        error,
      }),
    );
  }

  private shouldDeliver(task: TaskRecord, event: HarnessTaskEvent): boolean {
    const notifications = task.notifications;
    if (notifications?.enabled !== true) return false;
    if (!task.agentId || !task.conversationId) return false;
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

  private async appendNotificationDirectly(
    task: TaskRecord,
    entryId: string,
    message: HarnessMessage<HarnessTaskEventDetails>,
    timestamp: string,
  ): Promise<void> {
    const agent = this.deps.getAgent(task.agentId as string);
    await this.deps.harnessManager.appendHarnessMessageWithId(
      agent,
      entryId,
      message,
      timestamp,
    );
    const entry = await this.deps.appendEntry(
      {
        id: entryId,
        conversationId: task.conversationId as string,
        agentId: task.agentId,
        runId:
          task.origin.kind === "agent_tool" ? task.origin.runId : undefined,
        role: "system",
        kind: "task_event",
        text: message.content,
        details: {
          type: "task_event",
          source: "harness",
          ...message.details,
        },
        createdAt: timestamp,
      },
      { mirrorToHarness: false },
    );
    await this.deps.tasks.markNotificationDelivered(
      task.id,
      slotForEvent(message.details?.event ?? "completed"),
      entry.id,
      entry.createdAt,
    );
    await this.deps.events.publish("conversation.entry.appended", {
      conversationId: task.conversationId,
      agentId: task.agentId,
      runId: entry.runId,
      entry,
    });
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
      this.deps.tasks.getTask(taskId);
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

  private findExistingTaskEventEntry(
    task: TaskRecord,
    event: HarnessTaskEvent,
  ): ConversationEntry | undefined {
    if (!task.conversationId) return undefined;
    return this.deps
      .getConversationEntries(task.conversationId)
      .find((entry) => {
        if (entry.kind !== "task_event") return false;
        const details = asRecord(entry.details);
        return (
          details?.type === "task_event" &&
          details.taskId === task.id &&
          details.event === event
        );
      });
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
    value === "orphaned"
    ? value
    : undefined;
}
