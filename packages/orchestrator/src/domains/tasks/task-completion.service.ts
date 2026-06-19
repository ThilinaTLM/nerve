import type { AgentMessage } from "@nerve/agent";
import type {
  AgentRecord,
  ConversationEntry,
  EventEnvelope,
  TaskRecord,
} from "@nerve/shared";
import { createId } from "@nerve/shared";
import { buildProcessTextResult } from "@nerve/tools";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { ApplicationLogger } from "../../logging.js";
import type { AppendEntryInput } from "../../registry/types.js";
import type { AgentRunStateMap } from "../agents/run/run-state.js";
import type { HarnessManager } from "../conversations/harness-manager.js";
import type { TaskManager } from "./task-manager.js";

export interface TaskCompletionServiceDeps {
  tasks: TaskManager;
  events: EventBus;
  dataDir: string;
  runs: AgentRunStateMap;
  appendEntry(
    input: AppendEntryInput,
    options?: { mirrorToHarness?: boolean },
  ): Promise<ConversationEntry>;
  harnessManager: HarnessManager;
  getAgent(agentId: string): AgentRecord;
  logger?: ApplicationLogger;
}

const TERMINAL_TASK_EVENTS = new Set([
  "task.completed",
  "task.failed",
  "task.timed_out",
  "task.cancelled",
  "task.orphaned",
]);

export class TaskCompletionService {
  private unsubscribe?: () => void;
  private readonly injecting = new Set<string>();

  constructor(private readonly deps: TaskCompletionServiceDeps) {}

  start(): void {
    this.unsubscribe ??= this.deps.events.subscribe((event) => {
      void this.handleEvent(event);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private async handleEvent(event: EventEnvelope): Promise<void> {
    if (!TERMINAL_TASK_EVENTS.has(event.type)) return;
    const data = event.data as { task?: TaskRecord } | undefined;
    const task = data?.task;
    if (!task) return;
    await this.injectCompletion(task).catch((error) =>
      this.deps.logger?.warn("Task completion injection failed", {
        taskId: task.id,
        projectId: task.projectId,
        conversationId: task.conversationId,
        agentId: task.agentId,
        error,
      }),
    );
  }

  private async injectCompletion(task: TaskRecord): Promise<void> {
    if (task.completion?.inject !== true) return;
    if (task.completion.entryId) return;
    if (!task.agentId || !task.conversationId) return;
    if (this.injecting.has(task.id)) return;
    this.injecting.add(task.id);
    try {
      const latest = this.deps.tasks.getTask(task.id);
      if (latest.completion?.entryId) return;
      const timestamp = new Date().toISOString();
      const entryId = createId("entry");
      const text = await this.buildCompletionText(latest);
      const message: AgentMessage = {
        role: "custom",
        customType: "task_completion",
        content: text,
        display: true,
        details: {
          taskId: task.id,
          status: task.status,
          command: task.command,
        },
        timestamp: Date.parse(timestamp),
      };
      const activeRun = this.deps.runs.get(task.agentId);
      if (activeRun?.appendExternalMessage) {
        await activeRun.appendExternalMessage({
          id: entryId,
          message,
          timestamp,
        });
      } else {
        await this.deps.harnessManager.appendAgentMessageWithId(
          this.deps.getAgent(task.agentId),
          entryId,
          message,
          timestamp,
        );
      }
      const entry = await this.deps.appendEntry(
        {
          id: entryId,
          conversationId: task.conversationId,
          agentId: task.agentId,
          runId:
            task.origin.kind === "agent_tool" ? task.origin.runId : undefined,
          role: "system",
          kind: "message",
          text,
          details: {
            type: "task_completion",
            taskId: task.id,
            status: task.status,
            command: task.command,
            task,
          },
          createdAt: timestamp,
        },
        { mirrorToHarness: false },
      );
      await this.deps.tasks.markCompletionInjected(task.id, entryId, timestamp);
      await this.deps.events.publish("conversation.entry.appended", {
        conversationId: task.conversationId,
        agentId: task.agentId,
        runId: entry.runId,
        entry,
      });
    } finally {
      this.injecting.delete(task.id);
    }
  }

  private async buildCompletionText(task: TaskRecord): Promise<string> {
    const lineLimit = task.completion?.outputTailLineCount ?? 80;
    const logs = await this.deps.tasks.queryLogs(task.id, {
      mode: "recent",
      limit: lineLimit,
    });
    const lines = [
      `Background task ${task.id} finished.`,
      `Command: ${task.command}`,
      `Status: ${task.status}`,
    ];
    if (task.exitCode !== undefined) lines.push(`Exit code: ${task.exitCode}`);
    if (task.signal) lines.push(`Signal: ${task.signal}`);
    if (task.error) lines.push(`Error: ${task.error}`);
    if (task.readiness.outcome !== "none") {
      lines.push(
        `Readiness: ${task.readiness.outcome}${task.readiness.matched ? ` (${task.readiness.matched})` : ""}`,
      );
    }
    if (logs.events.length > 0) {
      lines.push("", "Recent output:");
      lines.push(
        ...logs.events.map(
          (event) =>
            `[${event.seq} ${event.stream} ${event.level}] ${event.line}`,
        ),
      );
    } else {
      lines.push("", "Recent output: (no captured log lines)");
    }
    lines.push("", `Use task_logs with taskId "${task.id}" for full logs.`);
    const bounded = await buildProcessTextResult({
      text: lines.join("\n"),
      outputFilePrefix: "nerve-task-completion",
      exitMessagePrefix: "Task completion",
      dataDir: this.deps.dataDir,
    });
    return bounded.content ?? lines.join("\n");
  }
}
