import { createId } from "@nervekit/contracts";
import type {
  AgentRecord,
  AsyncSubagentCompletion,
  AsyncSubagentOutcome,
} from "@nervekit/contracts/agents";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import { createHarnessMessage } from "@nervekit/harness/messages";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import type { WorkbenchRunUnitOfWork } from "../runs/persistence/run-transition.repository.js";
import type { WorkbenchLiveExecutions } from "../runs/application/run-live-executions.js";
import type { ConversationHarnessStorage } from "../conversations/conversation-harness-storage.js";
import type { AppendEntryInput } from "../conversations/append-entry-contracts.js";
import type { AsyncSubagentRepository } from "./async-subagent.repository.js";

export interface AsyncSubagentNotificationPorts {
  repository: Pick<AsyncSubagentRepository, "control" | "assignments"> & {
    store: Pick<
      AsyncSubagentRepository["store"],
      "listSubagentCompletions" | "putSubagentCompletion"
    >;
  };
  runs: Pick<WorkbenchRunUnitOfWork, "load" | "findActive">;
  live: Pick<WorkbenchLiveExecutions, "get">;
  events: Pick<StreamLogRegistry, "subscribe">;
  harnessStorage: Pick<
    ConversationHarnessStorage,
    "appendHarnessMessageWithId"
  >;
  getAgent(id: string): AgentRecord;
  entries(conversationId: string): Promise<ConversationEntry[]>;
  appendEntry(
    input: AppendEntryInput,
    options: { mirrorToHarness: boolean },
  ): Promise<ConversationEntry>;
  enabled(lead: AgentRecord): Promise<boolean>;
  wake(leadId: string): Promise<void>;
  reconcile(): Promise<void>;
  warn(error: unknown): void;
}

/** Durable run-completion delivery, using the same harness queue boundary as tasks. */
export class AsyncSubagentNotificationService {
  private unsubscribe?: () => void;
  private tail = Promise.resolve();
  private stopped = true;
  private readonly queued = new Map<string, string>();
  constructor(private readonly ports: AsyncSubagentNotificationPorts) {}

  start(): void {
    this.stopped = false;
    this.unsubscribe ??= this.ports.events.subscribe((event) => {
      if (
        event.type === "run.completed" ||
        event.type === "run.failed" ||
        event.type === "conversation.entry.appended" ||
        event.type === "project.capabilities.changed" ||
        event.type === "settings.updated" ||
        event.type === "project.updated"
      ) {
        void this.recover().catch((error) => this.ports.warn(error));
      }
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    await this.tail;
    this.queued.clear();
  }

  recover(): Promise<void> {
    const next = this.tail.then(() => this.sweep());
    this.tail = next.catch((error) => this.ports.warn(error));
    return next;
  }

  private async sweep(): Promise<void> {
    if (this.stopped) return;
    await this.ports.reconcile();
    const completions = new Map(
      (await this.ports.repository.store.listSubagentCompletions()).map(
        (record) => [record.runId, record],
      ),
    );
    for (const assignment of await this.ports.repository.assignments()) {
      if (completions.has(assignment.runId)) continue;
      const state = await this.ports.runs.load(assignment.runId);
      if (
        !state ||
        !["completed", "failed", "cancelled", "interrupted"].includes(
          state.run.status,
        )
      )
        continue;
      // A cancellation callback must not make an executing harness appear idle.
      if (this.ports.live.get(assignment.runId)) continue;
      let child: AgentRecord;
      try {
        child = this.ports.getAgent(assignment.childId);
      } catch {
        continue;
      }
      const team = await this.ports.repository.control(assignment.leadId);
      const completion: AsyncSubagentCompletion = {
        ...assignment,
        conversationId: child.conversationId,
        outcome:
          state.run.failure?.code === "RUN_INTERRUPTED_NO_RESUME"
            ? "interrupted"
            : (state.run.status as AsyncSubagentOutcome),
        entryId: createId("entry"),
        createdAt: new Date().toISOString(),
        suppressed: team.stopped || team.generation !== assignment.generation,
      };
      await this.ports.repository.store.putSubagentCompletion(completion);
      completions.set(completion.runId, completion);
    }
    for (const completion of completions.values()) {
      if (this.stopped) return;
      if (!completion.consumedAt && !completion.suppressed)
        await this.deliver(completion);
    }
  }

  private async deliver(record: AsyncSubagentCompletion): Promise<void> {
    const { repository } = this.ports;
    let lead: AgentRecord;
    let child: AgentRecord;
    try {
      lead = this.ports.getAgent(record.leadId);
      child = this.ports.getAgent(record.childId);
    } catch {
      return;
    }
    const team = await repository.control(lead.id);
    if (
      team.stopped ||
      team.generation !== record.generation ||
      !(await this.ports.enabled(lead))
    ) {
      await repository.store.putSubagentCompletion({
        ...record,
        suppressed: true,
      });
      return;
    }
    const entries = await this.ports.entries(lead.conversationId);
    const entry = entries.find((entry) => entry.id === record.entryId);
    if (entry && hasAssistantDescendant(entries, entry.id, lead.id)) {
      await repository.store.putSubagentCompletion({
        ...record,
        deliveredAt: entry.createdAt,
        consumedAt: new Date().toISOString(),
      });
      this.queued.delete(record.runId);
      return;
    }
    const active = await this.ports.runs.findActive(
      `${lead.conversationId}:${lead.id}`,
    );
    const activeRunId = active?.run.runId;
    if (!entry) {
      const text = `Developer teammate ${child.name} finished assignment run ${record.runId}: ${record.outcome}. Use subagent_status with the teammate's name to retrieve its response when idle, then accept it or send follow-up work. This notice refers to that run, not necessarily the teammate's current state.`;
      const message = createHarnessMessage(
        "subagent_event",
        text,
        {
          childId: child.id,
          childRunId: record.runId,
          outcome: record.outcome,
          notificationEntryId: record.entryId,
        },
        record.createdAt,
      );
      const live = activeRunId ? this.ports.live.get(activeRunId) : undefined;
      if (live?.enqueueHarnessMessage) {
        if (this.queued.get(record.runId) === activeRunId) return;
        try {
          await live.enqueueHarnessMessage({
            id: record.entryId,
            message,
            timestamp: record.createdAt,
            delivery: {
              event: "subagent_event",
              pendingNotificationId: record.entryId,
            },
          });
          this.queued.set(record.runId, activeRunId!);
          return;
        } catch {
          /* Live teardown: persist and let canonical admission choose the next run. */
        }
      }
      await this.ports.harnessStorage.appendHarnessMessageWithId(
        lead,
        record.entryId,
        message,
        record.createdAt,
      );
      await this.ports.appendEntry(
        {
          id: record.entryId,
          conversationId: lead.conversationId,
          agentId: lead.id,
          runId: activeRunId,
          role: "system",
          kind: "message",
          text,
          createdAt: record.createdAt,
          details: {
            source: "harness",
            type: "subagent_event",
            childId: child.id,
            childRunId: record.runId,
            notificationEntryId: record.entryId,
          },
        },
        { mirrorToHarness: false },
      );
    }
    await repository.store.putSubagentCompletion({
      ...record,
      deliveredAt: entry?.createdAt ?? new Date().toISOString(),
    });
    // An active run will consume the queued/persisted event or trigger another sweep at teardown.
    if (!activeRunId && !record.wokenAt && !this.stopped) {
      await this.ports.wake(lead.id);
      await repository.store.putSubagentCompletion({
        ...record,
        deliveredAt: entry?.createdAt ?? new Date().toISOString(),
        wokenAt: new Date().toISOString(),
      });
    }
  }
}

function hasAssistantDescendant(
  entries: ConversationEntry[],
  entryId: string,
  leadId: string,
): boolean {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return entries.some((entry) => {
    if (entry.role !== "assistant" || entry.agentId !== leadId) return false;
    const visited = new Set<string>();
    let parent = entry.parentEntryId;
    while (parent && !visited.has(parent)) {
      if (parent === entryId) return true;
      visited.add(parent);
      parent = byId.get(parent)?.parentEntryId;
    }
    return false;
  });
}
