import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import type { EventEnvelope } from "@nervekit/contracts/events";
import type { TaskLogEvent, TaskRecord } from "@nervekit/contracts/tasks";
import {
  TaskNotificationService,
  type TaskNotificationServiceDeps,
} from "../../../src/domains/tasks/application/task-notification.service.js";

class TestEvents {
  private seq = 0;
  private readonly listeners = new Set<(event: EventEnvelope) => void>();

  subscribe(listener: (event: EventEnvelope) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async publish<T>(type: string, data: T): Promise<EventEnvelope<T>> {
    const event: EventEnvelope<T> = {
      seq: ++this.seq,
      id: `evt_test_${this.seq}`,
      ts: new Date().toISOString(),
      type,
      data,
    };
    for (const listener of this.listeners) listener(event as EventEnvelope);
    await delay(0);
    return event;
  }
}

class FakeTasks {
  delivered: Array<{ slot: "ready" | "terminal"; entryId: string }> = [];
  pending: Array<{ slot: "ready" | "terminal"; entryId: string }> = [];

  constructor(
    private record: TaskRecord,
    private readonly logs: TaskLogEvent[] = [],
  ) {}

  listTasks(): TaskRecord[] {
    return [this.record];
  }

  getTask(taskId: string): TaskRecord {
    assert.equal(taskId, this.record.id);
    return this.record;
  }

  async queryLogs(): Promise<{ events: TaskLogEvent[]; nextCursor: number }> {
    return {
      events: this.logs,
      nextCursor: (this.logs.at(-1)?.seq ?? -1) + 1,
    };
  }

  async markCompletionInjected(
    _taskId: string,
    entryId: string,
    injectedAt = new Date().toISOString(),
  ): Promise<void> {
    this.patchCompletion({ entryId, injectedAt });
  }

  async markNotificationPending(
    _taskId: string,
    slot: "ready" | "terminal",
    entryId: string,
  ): Promise<void> {
    this.pending.push({ slot, entryId });
    this.patchNotification(
      slot === "ready"
        ? { readyEntryId: entryId }
        : { terminalEntryId: entryId },
    );
  }

  async markNotificationDelivered(
    _taskId: string,
    slot: "ready" | "terminal",
    entryId: string,
    deliveredAt: string,
  ): Promise<void> {
    this.delivered.push({ slot, entryId });
    this.patchNotification(
      slot === "ready"
        ? { readyEntryId: entryId, readyDeliveredAt: deliveredAt }
        : { terminalEntryId: entryId, terminalDeliveredAt: deliveredAt },
    );
  }

  private patchCompletion(
    patch: Partial<NonNullable<TaskRecord["completion"]>>,
  ): void {
    this.record = {
      ...this.record,
      completion: {
        inject: false,
        outputTailLineCount: 80,
        ...this.record.completion,
        ...patch,
      },
    };
  }

  private patchNotification(
    patch: Partial<NonNullable<TaskRecord["notifications"]>>,
  ): void {
    this.record = {
      ...this.record,
      notifications: {
        enabled: true,
        ready: true,
        terminal: true,
        outputTailLineCount: 80,
        ...this.record.notifications,
        ...patch,
      },
    };
  }
}

type Notice = Parameters<TaskNotificationServiceDeps["enqueueNotification"]>[0];

describe("TaskNotificationService durable queue delivery", () => {
  for (const phase of ["log read", "notification adapter"] as const) {
    it(`stop drains a pending event delivery held in its ${phase}`, async () => {
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      let closed = false;
      const context = createNotificationContext({
        enqueueNotification: async () => {
          if (phase === "notification adapter") {
            enter();
            await barrier;
          }
          assert.equal(closed, false, "notification wrote after close");
        },
      });
      const queryLogs = context.tasks.queryLogs.bind(context.tasks);
      context.tasks.queryLogs = async () => {
        if (phase === "log read") {
          enter();
          await barrier;
        }
        assert.equal(closed, false, "task log read after close");
        return queryLogs();
      };
      context.service.start();
      await context.events.publish("task.completed", { task: context.task });
      await entered;
      context.service.stop();
      let drained = false;
      const drain = context.service.settled().then(() => {
        drained = true;
        closed = true;
      });
      await delay(0);
      assert.equal(drained, false);
      release();
      await drain;
      await context.events.publish("task.completed", { task: context.task });
      await context.service.recoverPendingNotifications();
      assert.equal(context.notices.length, 1);
      assert.equal(context.tasks.delivered.length, 0);
      assert.equal(context.tasks.pending.length, 1);
    });
  }

  it("does not bypass a paused queue with live injection, direct append, or continuation", async () => {
    const context = createNotificationContext({
      task: taskRecord({
        completion: { inject: true, outputTailLineCount: 80 },
      }),
    });
    context.service.start();
    try {
      await context.events.publish("task.completed", { task: context.task });
      await waitFor(() => context.notices.length === 1);
      // The queue adapter accepts without delivering while paused.
      assert.deepEqual(context.tasks.delivered, []);
      assert.equal(
        context.tasks.getTask(context.task.id).completion?.injectedAt,
        undefined,
      );
      await context.events.publish("run.completed", {});
      await waitFor(() => context.notices.length === 2);
      assert.equal(context.notices[0]?.entryId, context.notices[1]?.entryId);
    } finally {
      context.service.stop();
    }
  });

  it("keeps acceptance pending across restart and stops retrying only after a delivery receipt", async () => {
    const context = createNotificationContext();
    await context.service.recoverPendingNotifications();
    assert.equal(context.notices.length, 1);
    assert.equal(context.tasks.delivered.length, 0);
    const entryId = context.notices[0]!.entryId;
    context.service.stop();
    const recovered = new TaskNotificationService(context.deps);
    await recovered.recoverPendingNotifications();
    assert.equal(context.notices[1]?.entryId, entryId);
    assert.equal(context.tasks.pending.length, 1);
    // The common adapter observes actual context insertion on a later retry.
    context.deps.enqueueNotification = async (notice) => {
      context.notices.push(notice);
      await context.tasks.markNotificationDelivered(
        notice.task.id,
        "terminal",
        "entry_common_delivery",
        "2026-01-02T03:04:07.000Z",
      );
    };
    await recovered.recoverPendingNotifications();
    await recovered.recoverPendingNotifications();
    assert.equal(context.notices.length, 3);
    assert.equal(
      context.tasks.getTask(context.task.id).notifications?.terminalEntryId,
      "entry_common_delivery",
    );
  });

  it("retries callback failure with the persisted identity and never falls back to direct injection", async () => {
    let attempts = 0;
    const context = createNotificationContext({
      enqueueNotification: async () => {
        if (++attempts === 1) throw new Error("queue unavailable");
      },
    });
    await context.service.recoverPendingNotifications();
    assert.equal(context.warnings.length, 1);
    assert.equal(context.tasks.delivered.length, 0);
    await context.service.recoverPendingNotifications();
    assert.equal(attempts, 2);
    assert.equal(context.notices[0]?.entryId, context.notices[1]?.entryId);
    assert.equal(context.tasks.pending.length, 1);
  });

  it("does not call the adapter before persisting the pending identity", async () => {
    const context = createNotificationContext();
    const persist = context.tasks.markNotificationPending.bind(context.tasks);
    context.tasks.markNotificationPending = async () => {
      throw new Error("pending write failed");
    };
    await context.service.recoverPendingNotifications();
    assert.equal(context.notices.length, 0);
    assert.equal(context.warnings.length, 1);
    assert.equal(context.tasks.delivered.length, 0);
    context.tasks.markNotificationPending = persist;
    await context.service.recoverPendingNotifications();
    assert.equal(context.notices.length, 1);
    assert.equal(
      context.notices[0]?.entryId,
      context.tasks.pending[0]?.entryId,
    );
  });

  it("logs event callback failures without losing retryability", async () => {
    const context = createNotificationContext({
      enqueueNotification: async () => {
        throw new Error("disk full");
      },
    });
    context.service.start();
    try {
      await context.events.publish("task.failed", { task: context.task });
      await waitFor(() => context.warnings.length === 1);
      assert.equal(context.tasks.delivered.length, 0);
      context.deps.enqueueNotification = async (notice) => {
        context.notices.push(notice);
      };
      await context.service.recoverPendingNotifications();
      assert.equal(context.notices.length, 2);
    } finally {
      context.service.stop();
    }
  });

  it("serializes concurrent recovery attempts until durable acceptance settles", async () => {
    let release!: () => void;
    const accepted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const context = createNotificationContext({
      enqueueNotification: () => accepted,
    });
    const first = context.service.recoverPendingNotifications();
    await waitFor(() => context.notices.length === 1);
    await context.service.recoverPendingNotifications();
    assert.equal(context.notices.length, 1);
    assert.equal(context.tasks.delivered.length, 0);
    release();
    await first;
    await context.service.recoverPendingNotifications();
    assert.equal(context.notices.length, 2);
    assert.equal(context.notices[0]?.entryId, context.notices[1]?.entryId);
  });

  it("does not treat legacy agent transcript events as common queue delivery receipts", async () => {
    const existing = taskEntry();
    const context = createNotificationContext({ existingEntries: [existing] });
    context.service.start();
    try {
      await context.events.publish("conversation.entry.appended", {
        entry: existing,
      });
      await context.service.recoverPendingNotifications();
      assert.equal(context.notices.length, 1);
      assert.equal(context.tasks.delivered.length, 0);
    } finally {
      context.service.stop();
    }
  });

  it("preserves UI-only legacy events and deduplicates their transcript entries", async () => {
    const context = createNotificationContext({
      task: taskRecord({ agentId: undefined }),
    });
    await context.service.recoverPendingNotifications();
    await context.service.recoverPendingNotifications();
    assert.equal(context.notices.length, 1);
    assert.equal(context.tasks.delivered.length, 1);
    const existingContext = createNotificationContext({
      task: taskRecord({ agentId: undefined }),
      existingEntries: [taskEntry({ agentId: undefined })],
    });
    await existingContext.service.recoverPendingNotifications();
    assert.equal(existingContext.notices.length, 0);
    assert.equal(existingContext.tasks.delivered[0]?.entryId, "entry_existing");
  });

  it("suppresses notifications rejected by policy or without a conversation", async () => {
    const context = createNotificationContext();
    context.deps.allowNotification = async () => false;
    await context.service.recoverPendingNotifications();
    assert.equal(context.notices.length, 0);
    assert.equal(context.tasks.pending.length, 0);
    const detached = createNotificationContext({
      task: taskRecord({ conversationId: undefined }),
    });
    await detached.service.recoverPendingNotifications();
    assert.equal(detached.notices.length, 0);
  });

  it("sends task command and relevant failure output to the adapter", async () => {
    const context = createNotificationContext({
      task: taskRecord({
        status: "failed",
        command: "printf one\nprintf two",
        exitCode: 1,
      }),
      logs: [
        {
          taskId: "task_test",
          seq: 5,
          ts: "2026-01-02T03:04:06.000Z",
          stream: "stderr",
          level: "warn",
          line: "two",
        },
      ],
    });
    await context.service.recoverPendingNotifications();
    const notice = context.notices[0]!;
    const details = notice.message.details as {
      command: string;
      commandPreview: string;
      output: string;
      event: string;
    };
    assert.equal(details.command, "printf one\nprintf two");
    assert.equal(details.commandPreview, "printf one printf two");
    assert.equal(details.output, "two");
    assert.equal(details.event, "failed");
    assert.match(notice.message.content, /Relevant output:/);
  });

  it("cancels a delayed ready notice when a terminal event wins", async () => {
    const context = createNotificationContext();
    context.service.start();
    try {
      await context.events.publish("task.ready", { task: context.task });
      await context.events.publish("task.completed", { task: context.task });
      await delay(550);
      assert.deepEqual(
        context.notices.map((notice) => notice.event),
        ["completed"],
      );
    } finally {
      context.service.stop();
    }
  });

  it("recovers ready and timeout notices through the same adapter", async () => {
    for (const outcome of ["ready", "timeout"] as const) {
      const context = createNotificationContext({
        task: taskRecord({
          status: "running",
          readiness: { outcome },
        }),
      });
      await context.service.recoverPendingNotifications();
      assert.equal(
        context.notices[0]?.event,
        outcome === "ready" ? "ready" : "ready_timeout",
      );
      assert.equal(context.tasks.pending[0]?.slot, "ready");
      assert.equal(context.tasks.delivered.length, 0);
    }
  });
});

function taskEntry(
  overrides: Partial<ConversationEntry> = {},
): ConversationEntry {
  return {
    id: "entry_existing",
    conversationId: "conv_test",
    agentId: "agent_test",
    role: "system",
    kind: "task_event",
    text: "Task completed.",
    details: { type: "task_event", taskId: "task_test", event: "completed" },
    createdAt: "2026-01-02T03:04:06.000Z",
    ...overrides,
  };
}

function createNotificationContext(
  options: {
    task?: TaskRecord;
    logs?: TaskLogEvent[];
    existingEntries?: ConversationEntry[];
    enqueueNotification?: TaskNotificationServiceDeps["enqueueNotification"];
  } = {},
) {
  const events = new TestEvents();
  const task = options.task ?? taskRecord();
  const tasks = new FakeTasks(task, options.logs);
  const notices: Notice[] = [];
  const warnings: unknown[] = [];
  const deps: TaskNotificationServiceDeps = {
    tasks: tasks as unknown as TaskNotificationServiceDeps["tasks"],
    events: events as unknown as TaskNotificationServiceDeps["events"],
    getConversationEntries: async () => options.existingEntries ?? [],
    enqueueNotification: async (notice) => {
      notices.push(notice);
      await options.enqueueNotification?.(notice);
    },
    logger: {
      warn: async (...args: unknown[]) => {
        warnings.push(args);
      },
    } as unknown as TaskNotificationServiceDeps["logger"],
  };
  return {
    service: new TaskNotificationService(deps),
    deps,
    events,
    task,
    tasks,
    notices,
    warnings,
  };
}

function taskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  const now = "2026-01-02T03:04:05.000Z";
  return {
    id: "task_test",
    projectId: "proj_test",
    conversationId: "conv_test",
    agentId: "agent_test",
    cwd: "/tmp/project",
    command: "pnpm test",
    status: "completed",
    readiness: { outcome: "none" },
    stdoutPath: "/tmp/task/stdout.log",
    stderrPath: "/tmp/task/stderr.log",
    logsPath: "/tmp/task/logs.jsonl",
    startedAt: now,
    updatedAt: now,
    finishedAt: now,
    exitCode: 0,
    origin: {
      kind: "agent_tool",
      toolCallId: "tool_test",
      runId: "run_test",
    },
    notifications: {
      enabled: true,
      ready: true,
      terminal: true,
      outputTailLineCount: 80,
    },
    visibility: "background",
    ...overrides,
  };
}

async function waitFor(
  predicate: () => boolean,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 500;
  const intervalMs = options.intervalMs ?? 5;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (predicate()) return;
    await delay(intervalMs);
  }
  assert.fail("Timed out waiting for condition.");
}
