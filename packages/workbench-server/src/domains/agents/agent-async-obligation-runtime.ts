import {
  agentAsyncObligationEntryId,
  type AgentRecord,
  type AsyncSubagentAssignment,
} from "@nervekit/contracts/agents";
import type { EventEnvelope } from "@nervekit/contracts/events";
import type { RunRecord } from "@nervekit/contracts/runs";
import type { TaskRecord } from "@nervekit/contracts/tasks";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import type { AgentAsyncObligationService } from "./agent-async-obligation.service.js";
import type { AgentAsyncObligationRepository } from "./agent-async-obligation.service.js";

const TERMINAL_TASK_EVENTS = new Set([
  "task.completed",
  "task.failed",
  "task.timed_out",
  "task.cancelled",
  "task.orphaned",
  "task.interrupted",
  "task.recovery_unknown",
]);

export interface AgentAsyncObligationRuntimePorts {
  service: AgentAsyncObligationService;
  repository: AgentAsyncObligationRepository;
  events: Pick<StreamLogRegistry, "subscribe">;
  getTask(id: string): TaskRecord;
  listTasks(): readonly TaskRecord[];
  getRun(id: string): Promise<RunRecord | undefined>;
  listAssignments(): Promise<readonly AsyncSubagentAssignment[]>;
  getAgent(id: string): AgentRecord;
  now?(): string;
  warn?(error: unknown): void;
}

/** Source-event adapter and serialized recovery trigger for async obligations. */
export class AgentAsyncObligationRuntime {
  private unsubscribe?: () => void;
  private tail = Promise.resolve();
  constructor(private readonly ports: AgentAsyncObligationRuntimePorts) {}

  async start(): Promise<void> {
    this.ports.service.start();
    this.unsubscribe ??= this.ports.events.subscribe((event) => {
      if (
        TERMINAL_TASK_EVENTS.has(event.type) ||
        event.type === "task.promoted" ||
        event.type === "conversation.entry.appended" ||
        event.type === "run.completed" ||
        event.type === "run.failed" ||
        event.type === "run.cancelled"
      ) {
        this.schedule(event);
      }
    });
    await this.reconcileMissingSources();
    await this.reconcilePendingSources();
    await this.ports.service.recover();
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    await this.tail;
    await this.ports.service.stop();
  }

  private schedule(event: EventEnvelope): void {
    const next = this.tail.then(async () => {
      if (
        TERMINAL_TASK_EVENTS.has(event.type) ||
        event.type === "task.promoted"
      ) {
        const task = (event.data as { task?: TaskRecord } | undefined)?.task;
        if (task) {
          let current = task;
          try {
            current = this.ports.getTask(task.id);
          } catch {
            // Fall back to the committed event snapshot.
          }
          if (isTerminal(current)) await this.readyPromotedTask(current);
        }
      }
      if (
        event.type === "run.completed" ||
        event.type === "run.failed" ||
        event.type === "run.cancelled"
      ) {
        const data = event.data as
          | { runId?: string; interrupted?: boolean }
          | undefined;
        if (data?.runId) {
          await this.readySubagentRun(
            data.runId,
            data.interrupted ? "interrupted" : event.type.replace("run.", ""),
          );
        }
      }
      await this.ports.service.recover();
    });
    this.tail = next.catch((error) => this.ports.warn?.(error));
  }

  private async reconcileMissingSources(): Promise<void> {
    for (const task of this.ports.listTasks()) {
      if (
        !requiresPromotedTaskObligation(task) ||
        !task.conversationId ||
        !task.agentId
      ) {
        continue;
      }
      const generation = task.restartGeneration ?? 0;
      const id = `promoted_task:${task.id}:${generation}`;
      if (await this.ports.repository.get(id)) continue;
      await this.ports.service.register({
        id,
        conversationId: task.conversationId,
        ownerAgentId: task.agentId,
        sourceKind: "promoted_task",
        sourceId: task.id,
        state: "pending",
        notificationEntryId: agentAsyncObligationEntryId(
          "promoted_task",
          task.id,
          generation,
        ),
        generation,
        createdAt: task.startedAt,
        updatedAt: task.updatedAt,
      });
    }

    for (const assignment of await this.ports.listAssignments()) {
      const id = `async_subagent:${assignment.runId}:${assignment.generation}`;
      if (await this.ports.repository.get(id)) continue;
      const lead = this.ports.getAgent(assignment.leadId);
      const run = await this.ports.getRun(assignment.runId);
      const timestamp = run?.createdAt ?? this.now();
      await this.ports.service.register({
        id,
        conversationId: lead.conversationId,
        ownerAgentId: assignment.leadId,
        sourceKind: "async_subagent",
        sourceId: assignment.runId,
        sourceAgentId: assignment.childId,
        state: "pending",
        notificationEntryId: agentAsyncObligationEntryId(
          "async_subagent",
          assignment.runId,
          assignment.generation,
        ),
        generation: assignment.generation,
        createdAt: timestamp,
        updatedAt: run?.updatedAt ?? timestamp,
      });
      if (!run) {
        await this.ports.service.markReady(id, "launch_failed");
      }
    }
  }

  private async reconcilePendingSources(): Promise<void> {
    const pending = await this.ports.repository.listByStates(["pending"]);
    for (const obligation of pending) {
      if (obligation.sourceKind === "promoted_task") {
        let task: TaskRecord;
        try {
          task = this.ports.getTask(obligation.sourceId);
        } catch {
          continue;
        }
        if (isTerminal(task)) await this.readyPromotedTask(task);
        continue;
      }
      const run = await this.ports.getRun(obligation.sourceId);
      if (run && isTerminalSubagentRun(run)) {
        await this.ports.service.markReady(obligation.id, run.status);
      }
    }
  }

  private async readyPromotedTask(task: TaskRecord): Promise<void> {
    const id = `promoted_task:${task.id}:${task.restartGeneration ?? 0}`;
    const obligation = await this.ports.repository.get(id);
    if (!obligation || obligation.state !== "pending") return;
    await this.ports.service.markReady(id, task.status);
  }

  private async readySubagentRun(
    runId: string,
    outcome: string,
  ): Promise<void> {
    const pending = await this.ports.repository.listByStates(["pending"]);
    const obligation = pending.find(
      (candidate) =>
        candidate.sourceKind === "async_subagent" &&
        candidate.sourceId === runId,
    );
    if (!obligation) return;
    await this.ports.service.markReady(obligation.id, outcome);
  }

  private now(): string {
    return this.ports.now?.() ?? new Date().toISOString();
  }
}

function isTerminal(task: TaskRecord): boolean {
  return !["starting", "running", "ready", "stopping"].includes(task.status);
}

function requiresPromotedTaskObligation(task: TaskRecord): boolean {
  return (
    task.completion?.inject === true ||
    (task.visibility === "background" &&
      task.origin.kind === "agent_tool" &&
      task.notifications?.enabled === true &&
      task.notifications.terminal === false)
  );
}

function isTerminalSubagentRun(run: RunRecord): boolean {
  return ["completed", "failed", "cancelled"].includes(run.status);
}
