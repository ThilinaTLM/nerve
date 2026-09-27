import type {
  AgentAsyncObligation,
  AgentRecord,
} from "@nervekit/contracts/agents";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import type {
  TaskLogQueryResponse,
  TaskRecord,
} from "@nervekit/contracts/tasks";
import {
  createHarnessMessage,
  type HarnessTaskEvent,
  type HarnessTaskEventDetails,
} from "@nervekit/harness/messages";
import {
  formatTaskEventSummary,
  taskCommandDisplay,
  taskCommandPreview,
  taskOutputDisplay,
} from "../tasks/model/task-summary-format.js";
import type {
  AsyncObligationNotice,
  AsyncObligationSourceAdapter,
} from "./agent-async-obligation.service.js";

export interface PromotedTaskObligationAdapterPorts {
  getTask(id: string): TaskRecord;
  queryLogs(taskId: string): Promise<TaskLogQueryResponse>;
  now?(): string;
}

/** Converts a terminal auto-promoted Bash task into the shared notice shape. */
export class PromotedTaskObligationAdapter implements AsyncObligationSourceAdapter {
  readonly kind = "promoted_task" as const;
  constructor(private readonly ports: PromotedTaskObligationAdapterPorts) {}

  async allow(): Promise<boolean> {
    return true;
  }

  async buildNotice(
    obligation: AgentAsyncObligation,
  ): Promise<AsyncObligationNotice> {
    const task = this.ports.getTask(obligation.sourceId);
    const logs = await this.ports.queryLogs(task.id);
    const event = terminalTaskEvent(task.status);
    const timestamp =
      obligation.updatedAt ?? this.ports.now?.() ?? new Date().toISOString();
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
      notificationEntryId: obligation.notificationEntryId,
    };
    return {
      message: createHarnessMessage("task_event", text, details, timestamp),
      entry: {
        id: obligation.notificationEntryId,
        conversationId: obligation.conversationId,
        agentId: obligation.ownerAgentId,
        runId:
          task.origin.kind === "agent_tool" ? task.origin.runId : undefined,
        role: "system",
        kind: "task_event",
        text,
        details: { type: "task_event", source: "harness", ...details },
        createdAt: timestamp,
      },
    };
  }
}

function terminalTaskEvent(status: TaskRecord["status"]): HarnessTaskEvent {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "timed_out":
      return "timed_out";
    case "cancelled":
      return "cancelled";
    case "orphaned":
      return "orphaned";
    case "interrupted":
      return "interrupted";
    default:
      return "recovery_unknown";
  }
}

export interface AsyncSubagentObligationAdapterPorts {
  getAgent(id: string): AgentRecord;
  entries(conversationId: string): Promise<readonly ConversationEntry[]>;
  enabled(lead: AgentRecord): Promise<boolean>;
  generation(
    leadAgentId: string,
  ): Promise<{ generation: number; stopped: boolean }>;
}

/** Applies team-generation policy and formats an async teammate outcome. */
export class AsyncSubagentObligationAdapter implements AsyncObligationSourceAdapter {
  readonly kind = "async_subagent" as const;
  constructor(private readonly ports: AsyncSubagentObligationAdapterPorts) {}

  async allow(obligation: AgentAsyncObligation): Promise<boolean> {
    const lead = this.ports.getAgent(obligation.ownerAgentId);
    const team = await this.ports.generation(lead.id);
    return (
      !team.stopped &&
      team.generation === obligation.generation &&
      (await this.ports.enabled(lead))
    );
  }

  async buildNotice(
    obligation: AgentAsyncObligation,
  ): Promise<AsyncObligationNotice> {
    if (!obligation.sourceAgentId) {
      throw new Error(
        `Subagent obligation '${obligation.id}' has no source agent.`,
      );
    }
    const child = this.ports.getAgent(obligation.sourceAgentId);
    const response = (await this.ports.entries(child.conversationId))
      .filter(
        (entry) =>
          entry.agentId === child.id &&
          entry.runId === obligation.sourceId &&
          entry.role === "assistant",
      )
      .at(-1)
      ?.text?.trim();
    const outcome = obligation.outcome ?? "unknown";
    const text = `Developer teammate ${child.name ?? child.id} finished assignment: ${outcome}. This notice refers to that assignment, not necessarily the teammate's current state. ${
      response
        ? `\n\n${outcome === "completed" ? "Final response" : "Last response (assignment did not complete)"}:\n${response}`
        : "No response was recorded for this assignment."
    }`;
    const details = {
      childId: child.id,
      childName: child.name,
      childRunId: obligation.sourceId,
      outcome,
      notificationEntryId: obligation.notificationEntryId,
    };
    return {
      message: createHarnessMessage(
        "subagent_event",
        text,
        details as never,
        obligation.updatedAt,
      ),
      entry: {
        id: obligation.notificationEntryId,
        conversationId: obligation.conversationId,
        agentId: obligation.ownerAgentId,
        role: "system",
        kind: "subagent_run_event",
        text,
        details: { source: "harness", type: "subagent_event", ...details },
        createdAt: obligation.updatedAt,
      },
    };
  }
}
