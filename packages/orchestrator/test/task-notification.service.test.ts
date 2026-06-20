import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { AgentMessage } from "@nerve/agent";
import type {
  AgentRecord,
  ConversationEntry,
  EventEnvelope,
  TaskLogEvent,
  TaskRecord,
} from "@nerve/shared";
import type { AgentRunStateMap } from "../src/domains/agents/run/run-state.js";
import {
  TaskNotificationService,
  type TaskNotificationServiceDeps,
} from "../src/domains/tasks/task-notification.service.js";

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
      durability: "durable",
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

  constructor(private record: TaskRecord) {}

  listTasks(): TaskRecord[] {
    return [this.record];
  }

  getTask(taskId: string): TaskRecord {
    assert.equal(taskId, this.record.id);
    return this.record;
  }

  async queryLogs(): Promise<{ events: TaskLogEvent[]; nextCursor: number }> {
    return { events: [], nextCursor: 0 };
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

describe("TaskNotificationService awaited task continuation", () => {
  it("continues an idle agent after an awaited promoted bash task terminates", async () => {
    const context = createNotificationContext({
      task: taskRecord({
        completion: { inject: true, outputTailLineCount: 80 },
      }),
    });
    context.service.start();

    await context.events.publish("task.completed", { task: context.task });
    await waitFor(() => context.continuedAgentIds.length === 1);

    assert.deepEqual(context.continuedAgentIds, [context.agent.id]);
    assert.equal(context.entries.length, 1);
    assert.equal(context.entries[0]?.kind, "task_event");
    assert.equal(
      context.tasks.delivered.some((row) => row.slot === "terminal"),
      true,
    );
    context.service.stop();
  });

  it("does not continue detached task_start tasks after terminal notifications", async () => {
    const context = createNotificationContext({ task: taskRecord() });
    context.service.start();

    await context.events.publish("task.completed", { task: context.task });
    await delay(10);

    assert.deepEqual(context.continuedAgentIds, []);
    assert.equal(context.entries.length, 1);
    assert.equal(context.entries[0]?.kind, "task_event");
    context.service.stop();
  });

  it("queues notifications into an active run without starting a second run", async () => {
    const enqueued: AgentMessage[] = [];
    const context = createNotificationContext({
      task: taskRecord({
        completion: { inject: true, outputTailLineCount: 80 },
      }),
      runs: new Map([
        [
          "agent_test",
          {
            runId: "run_test",
            abort: () => undefined,
            messages: [],
            enqueueHarnessMessage: async (input) => {
              enqueued.push(input.message);
            },
          },
        ],
      ]),
    });
    context.service.start();

    await context.events.publish("task.completed", { task: context.task });
    await waitFor(() => enqueued.length === 1);

    assert.deepEqual(context.continuedAgentIds, []);
    assert.equal(context.entries.length, 0);
    assert.equal(enqueued[0]?.role, "harness");
    context.service.stop();
  });
});

function createNotificationContext(options: {
  task: TaskRecord;
  runs?: AgentRunStateMap;
  agent?: AgentRecord;
}) {
  const events = new TestEvents();
  const task = options.task;
  const tasks = new FakeTasks(task);
  const entries: ConversationEntry[] = [];
  const harnessMessages: Array<{
    id: string;
    message: AgentMessage;
    timestamp: string;
  }> = [];
  const continuedAgentIds: string[] = [];
  const agent = options.agent ?? agentRecord();
  const deps: TaskNotificationServiceDeps = {
    tasks: tasks as unknown as TaskNotificationServiceDeps["tasks"],
    events: events as unknown as TaskNotificationServiceDeps["events"],
    runs: options.runs ?? new Map(),
    appendEntry: async (input) => {
      const entry = {
        id: input.id ?? `entry_test_${entries.length + 1}`,
        conversationId: input.conversationId,
        agentId: input.agentId,
        runId: input.runId,
        turnId: input.turnId,
        liveMessageId: input.liveMessageId,
        parentEntryId: input.parentEntryId,
        role: input.role,
        kind: input.kind ?? "message",
        text: input.text,
        summary: input.summary,
        tokensBefore: input.tokensBefore,
        usage: input.usage,
        firstKeptEntryId: input.firstKeptEntryId,
        fromEntryId: input.fromEntryId,
        details: input.details,
        createdAt: input.createdAt ?? new Date().toISOString(),
      } satisfies ConversationEntry;
      entries.push(entry);
      return entry;
    },
    harnessManager: {
      appendHarnessMessageWithId: async (_agent, id, message, timestamp) => {
        harnessMessages.push({ id, message, timestamp });
      },
    } as unknown as TaskNotificationServiceDeps["harnessManager"],
    getAgent: () => agent,
    getConversationEntries: () => entries,
    continueAgent: async (agentId) => {
      continuedAgentIds.push(agentId);
    },
  };
  return {
    service: new TaskNotificationService(deps),
    events,
    tasks,
    task,
    agent,
    entries,
    harnessMessages,
    continuedAgentIds,
  };
}

function taskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  const now = "2026-01-02T03:04:05.000Z";
  return {
    id: "task_test",
    workerId: "worker_test",
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
    origin: { kind: "agent_tool", toolCallId: "tool_test" },
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

function agentRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
  const now = "2026-01-02T03:04:05.000Z";
  return {
    id: "agent_test",
    conversationId: "conv_test",
    projectId: "proj_test",
    projectDir: "/tmp/project",
    workerId: "worker_test",
    rootAgentId: "agent_test",
    mode: "coding",
    permissionLevel: "autonomous",
    workspaceScope: { roots: ["/tmp/project"] },
    budget: { depth: 0, maxDepth: 3, maxRuns: 8, usedRuns: 0 },
    thinkingLevel: "off",
    status: "idle",
    createdAt: now,
    updatedAt: now,
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
