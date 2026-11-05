import type { ConversationEvent } from "@nervekit/contracts/core";
import type { ConversationCore, ExecutionFinished } from "../core.js";
import {
  finalAssistantText,
  inlineReport,
  lastMessageLabel,
} from "../delegation/child-report.js";
import {
  backgroundLabel,
  backgroundLines,
} from "../delegation/subagent-status.js";
import type {
  TaskOutcome,
  TaskRef,
  TaskRunner,
  TaskTerminal,
} from "./background-task.js";

export interface SubagentRunnerDeps {
  core: ConversationCore;
  /** The profile named by the creating call, when known. */
  profileOf(
    parentId: string,
    child: { title: string; parentToolCallId: string | null },
  ): string | null;
  recent(id: string): ConversationEvent[];
  failureMessage(result: ExecutionFinished | undefined): string | null;
}

/**
 * A sub-agent is a full conversation: the conversation runner executes and recovers it,
 * so this runner only turns a finished execution into the parent's terminal notice.
 */
export class SubagentRunner implements TaskRunner {
  readonly kind = "subagent" as const;
  // Children stopped by `subagent_stop`: the tool result already reports it.
  private readonly stoppedByTool = new Set<string>();

  constructor(private readonly deps: SubagentRunnerDeps) {}

  /** Run `stop` for a child whose cancellation the calling tool result reports itself. */
  async stoppingByTool<T>(childId: string, stop: () => Promise<T>): Promise<T> {
    this.stoppedByTool.add(childId);
    try {
      return await stop();
    } finally {
      this.stoppedByTool.delete(childId);
    }
  }

  running(): TaskRef[] {
    return [];
  }
  isRunning(): boolean {
    return false; // Stopping goes through the conversation, not the task service.
  }
  async recover(): Promise<undefined> {
    return undefined;
  }
  async describe(): Promise<TaskTerminal> {
    throw new Error("Sub-agent terminals come from finished executions");
  }

  suppressNotice(ref: TaskRef, terminal: TaskTerminal): boolean {
    if (terminal.outcome !== "cancelled") return false;
    // A stop cascading from the lead pauses the lead first, and a notice would only grow its next turn.
    return (
      this.stoppedByTool.has(ref.id) ||
      this.deps.core.getSnapshot(ref.parentConversationId).conversation.paused
    );
  }

  /** Terminal and ref for a finished child execution; undefined when it has no parent. */
  terminalOf(
    result: ExecutionFinished,
  ): { ref: TaskRef; terminal: TaskTerminal } | undefined {
    const { core, profileOf, recent, failureMessage } = this.deps;
    const child = core.getSnapshot(result.conversationId);
    const parentId = child.conversation.parentConversationId;
    if (!parentId) return undefined;
    const profile = profileOf(parentId, child.conversation);
    const head = `Sub-agent "${child.conversation.title}"${profile ? ` (${profile})` : ""}`;
    const background = child.asyncBash.filter(
      (row) => row.status === "running",
    );
    const response = finalAssistantText(core, result);
    const report = response
      ? inlineReport(core, result.conversationId, result.executionId, response)
      : "";
    // A completed notice already says so; other outcomes label the message so it is not taken as a report.
    const body = !report
      ? ""
      : result.transition === "completed"
        ? `\n${report}`
        : `\n${lastMessageLabel(false)}\n${report}`;
    let first: string;
    if (result.transition === "cancelled")
      first = `${head} was stopped by the user.`;
    else if (result.transition === "failed")
      first = `${head} failed: ${failureMessage(result) ?? "unknown error"}`;
    else if (result.transition === "interrupted")
      first = `${head} interrupted.`;
    else if (background.length)
      first = [
        `${head} is waiting on ${backgroundLabel(background.length)} and accepts follow-ups:`,
        ...backgroundLines(background, Date.now()),
      ].join("\n");
    else first = `${head} completed.`;
    // The assignment this execution worked on: its first parent-sourced message.
    let assignmentId = result.executionId;
    for (const event of recent(result.conversationId)) {
      if (event.id === result.executionId) break;
      if (
        event.sequence < result.event.sequence &&
        event.type === "user_message" &&
        event.payload.source === "parent_conversation" &&
        event.inputId
      )
        assignmentId = event.inputId;
    }
    const outcome: TaskOutcome = result.transition;
    return {
      ref: {
        kind: "subagent",
        id: result.conversationId,
        parentConversationId: parentId,
      },
      terminal: {
        outcome,
        text: `${first}${body}`,
        assetIds: [],
        detail: { kind: "subagent", assignmentId },
        noticeInputId: `input_${result.executionId}`,
      },
    };
  }
}
