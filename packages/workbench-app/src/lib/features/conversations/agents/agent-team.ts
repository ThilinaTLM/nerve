import type { AsyncBash, ConversationSummary } from "@nervekit/contracts/core";
import type { PendingWorkItem } from "$lib/presentation/transcript/activity/run-activity";
import type {
  AgentActivitySnapshot,
  AgentRecord,
} from "$lib/presentation/view-models/conversation";

/** Longest background command text kept in a chip. */
const COMMAND_LABEL_CHARS = 48;

export type AgentRowState =
  | "needs_you"
  | "working"
  | "waiting"
  | "idle"
  | "failed"
  | "stopped";

/** Profile badge for a sub-agent. */
export function subagentProfileLabel(agent: AgentRecord): string | undefined {
  return agent.subagentProfile;
}

export function agentRowState(
  activity: AgentActivitySnapshot | undefined,
): AgentRowState {
  switch (activity?.state) {
    case "awaiting_user":
      return "needs_you";
    case "running":
      return "working";
    case "awaiting_async":
      return "waiting";
    case "error":
      return "failed";
    case "aborted":
      return "stopped";
    default:
      return "idle";
  }
}

export const AGENT_STATE_LABEL: Record<AgentRowState, string> = {
  needs_you: "needs you",
  working: "working",
  waiting: "waiting",
  idle: "idle",
  failed: "failed",
  stopped: "stopped",
};

export function runningCommands(
  asyncBash: readonly AsyncBash[] | undefined,
): AsyncBash[] {
  return (asyncBash ?? []).filter((task) => task.status === "running");
}

function commandLabel(command: string): string {
  const line = command.trim().split("\n")[0] ?? "";
  return line.length > COMMAND_LABEL_CHARS
    ? `${line.slice(0, COMMAND_LABEL_CHARS - 1)}…`
    : line;
}

/**
 * What a conversation with no running turn is still waiting for: sub-agents
 * that have not finished and background commands that are still running.
 */
export function pendingWork(input: {
  children: readonly Pick<ConversationSummary, "id" | "title" | "status">[];
  asyncBash: readonly AsyncBash[];
}): PendingWorkItem[] {
  return [
    ...input.children
      .filter(
        (child) => child.status === "running" || child.status === "waiting",
      )
      .map(
        (child): PendingWorkItem => ({
          kind: "agent",
          id: child.id,
          label: child.title.trim() || "Sub-agent",
        }),
      ),
    ...runningCommands(input.asyncBash).map(
      (task): PendingWorkItem => ({
        kind: "command",
        id: task.id,
        label: commandLabel(task.command),
      }),
    ),
  ];
}
