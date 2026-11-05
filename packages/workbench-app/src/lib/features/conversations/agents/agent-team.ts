import type { AsyncBash, ConversationSummary } from "@nervekit/contracts/core";
import { compareSubagents } from "$lib/presentation/conversations/subagent-order";
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
export function agentProfileLabel(agent: AgentRecord): string | undefined {
  return agent.agentProfile;
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
 * Whether `conversation.stop` has anything to stop: the conversation's own
 * turn, its background commands, or any descendant's work. Idle
 * conversations can still wake when background work reports back.
 */
export function hasStoppableWork(
  snapshot:
    | {
        conversation: Pick<ConversationSummary, "status">;
        children: readonly Pick<
          ConversationSummary,
          "status" | "pendingWork"
        >[];
        asyncBash: readonly AsyncBash[];
      }
    | undefined,
): boolean {
  if (!snapshot) return false;
  const active = (status: ConversationSummary["status"]) =>
    status === "running" || status === "waiting";
  return (
    active(snapshot.conversation.status) ||
    runningCommands(snapshot.asyncBash).length > 0 ||
    snapshot.children.some((child) => active(child.status) || child.pendingWork)
  );
}

/**
 * What a conversation with no running turn is still waiting for: sub-agents
 * that have not finished and background commands that are still running.
 */
export function pendingWork(input: {
  children: readonly Pick<
    ConversationSummary,
    "id" | "title" | "status" | "createdAt" | "lastParentPromptAt"
  >[];
  asyncBash: readonly AsyncBash[];
}): PendingWorkItem[] {
  return [
    ...input.children
      .filter(
        (child) => child.status === "running" || child.status === "waiting",
      )
      .sort(compareSubagents)
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
