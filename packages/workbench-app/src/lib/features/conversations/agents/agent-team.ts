import type { AsyncBash, ConversationSummary } from "@nervekit/contracts/core";
import { SUBAGENT_FOLD_AFTER_MS } from "@nervekit/contracts/subagents";
import { shortAgentModel } from "$lib/domain/projects/project-tree";
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

export type AgentTeamRow = {
  id: string;
  label: string;
  /** Profile badge text; the lead has none. */
  profile?: string;
  state: AgentRowState;
  model: string;
  updatedAt: string;
  lead: boolean;
  viewed: boolean;
};

export type AgentTeam = {
  lead: AgentTeamRow;
  /** Sub-agents shown in the tree, attention first, then by recency. */
  visible: AgentTeamRow[];
  /** Sub-agents folded under the "N earlier" row. */
  folded: AgentTeamRow[];
  /** All sub-agents, folded or not. */
  size: number;
  working: number;
  /** Needs the user, or waits on background work. */
  attention: number;
};

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

/**
 * Whether a sub-agent folds into "N earlier". Only settled (idle or stopped)
 * rows fold; failed, running, waiting and the viewed one never do. Computed
 * from timestamps, so it is identical after a reload.
 */
export function isFolded(row: AgentTeamRow, nowMs: number): boolean {
  if (row.lead || row.viewed) return false;
  if (row.state !== "idle" && row.state !== "stopped") return false;
  const updated = Date.parse(row.updatedAt);
  return Number.isFinite(updated) && nowMs - updated >= SUBAGENT_FOLD_AFTER_MS;
}

const STATE_RANK: Record<AgentRowState, number> = {
  needs_you: 0,
  working: 1,
  waiting: 2,
  failed: 3,
  idle: 4,
  stopped: 4,
};

function byAttentionThenRecency(a: AgentTeamRow, b: AgentTeamRow): number {
  return (
    STATE_RANK[a.state] - STATE_RANK[b.state] ||
    Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  );
}

function rowOf(
  agent: AgentRecord,
  activities: Readonly<Record<string, AgentActivitySnapshot>>,
  viewedId: string | undefined,
  label: string,
): AgentTeamRow {
  return {
    id: agent.id,
    label,
    profile: subagentProfileLabel(agent),
    state: agentRowState(activities[agent.id]),
    model: shortAgentModel(agent),
    updatedAt: agent.updatedAt,
    lead: !agent.parentAgentId,
    viewed: agent.id === viewedId,
  };
}

/** The lead and its sub-agents as one two-level tree; undefined without a lead. */
export function buildAgentTeam(input: {
  agents: readonly AgentRecord[];
  activities: Readonly<Record<string, AgentActivitySnapshot>>;
  leadTitle: string;
  viewedId?: string;
  nowMs: number;
}): AgentTeam | undefined {
  const leadAgent = input.agents.find((agent) => !agent.parentAgentId);
  if (!leadAgent) return undefined;
  const children = input.agents
    .filter((agent) => agent.parentAgentId)
    .map((agent) =>
      rowOf(
        agent,
        input.activities,
        input.viewedId,
        agent.name?.trim() || "Sub-agent",
      ),
    )
    .sort(byAttentionThenRecency);
  return {
    lead: rowOf(leadAgent, input.activities, input.viewedId, input.leadTitle),
    visible: children.filter((row) => !isFolded(row, input.nowMs)),
    folded: children.filter((row) => isFolded(row, input.nowMs)),
    size: children.length,
    working: children.filter((row) => row.state === "working").length,
    attention: children.filter(
      (row) => row.state === "needs_you" || row.state === "waiting",
    ).length,
  };
}

export type AgentsPillSummary = {
  /** Sub-agents in the team. */
  size: number;
  working: number;
  commands: number;
  dot?: "info" | "warning";
};

/** Collapsed pill content: team size, how many work, background commands. */
export function agentsPillSummary(
  team: AgentTeam | undefined,
  commandCount: number,
): AgentsPillSummary | undefined {
  const size = team?.size ?? 0;
  if (size === 0 && commandCount === 0) return undefined;
  const working = team?.working ?? 0;
  const attention = team?.attention ?? 0;
  return {
    size,
    working,
    commands: commandCount,
    dot: attention > 0 ? "warning" : working > 0 ? "info" : undefined,
  };
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
