import type { AsyncBash } from "@nervekit/contracts/core";
import type {
  AgentActivitySnapshot,
  AgentRecord,
} from "$lib/presentation/view-models/conversation";
import {
  agentRowState,
  subagentProfileLabel,
  type AgentRowState,
} from "./agent-team";

export type ActivityIslandSection = "agents" | "commands" | null;
export type IslandAgentRow = {
  agent: AgentRecord;
  name: string;
  profile?: string;
  state: AgentRowState;
  recent: boolean;
  viewed: boolean;
};

const rank: Record<AgentRowState, number> = {
  needs_you: 0,
  working: 1,
  waiting: 2,
  failed: 3,
  idle: 4,
  stopped: 4,
};

function timestamp(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

/** All retained children, without age folding. The lead is navigation, not a row. */
export function islandAgents(
  agents: readonly AgentRecord[],
  activities: Readonly<Record<string, AgentActivitySnapshot>>,
  viewedId: string,
): { leadId?: string; rows: IslandAgentRow[]; running: number; total: number } {
  const rows = agents
    .filter((agent) => Boolean(agent.parentAgentId))
    .map((agent): IslandAgentRow => {
      const state = agentRowState(activities[agent.id]);
      return {
        agent,
        name: agent.name?.trim() || "Sub-agent",
        profile: subagentProfileLabel(agent),
        state,
        recent: state === "idle" || state === "stopped",
        viewed: agent.id === viewedId,
      };
    })
    .sort(
      (a, b) =>
        rank[a.state] - rank[b.state] ||
        timestamp(b.agent.updatedAt) - timestamp(a.agent.updatedAt) ||
        a.agent.id.localeCompare(b.agent.id),
    );
  return {
    leadId: agents.find((agent) => !agent.parentAgentId)?.id,
    rows,
    running: rows.filter((row) => row.state === "working").length,
    total: rows.length,
  };
}

/** Every running command plus the five most recently settled, independent of input order. */
export function islandCommands(commands: readonly AsyncBash[]): {
  rows: AsyncBash[];
  running: number;
  total: number;
} {
  const running = commands
    .filter((command) => command.status === "running")
    .sort(
      (a, b) =>
        timestamp(b.startedAt) - timestamp(a.startedAt) ||
        a.id.localeCompare(b.id),
    );
  const settled = commands
    .filter((command) => command.status !== "running")
    .sort(
      (a, b) =>
        timestamp(b.finishedAt ?? b.startedAt) -
          timestamp(a.finishedAt ?? a.startedAt) || a.id.localeCompare(b.id),
    )
    .slice(0, 5);
  const rows = [...running, ...settled];
  return {
    rows,
    running: running.length,
    // Count only accessible rows; older settled commands have no history UI.
    total: rows.length,
  };
}

export const COMMAND_STATE_LABEL: Record<AsyncBash["status"], string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  timed_out: "Timed out",
  cancelled: "Cancelled",
  lost: "Lost",
};

export function islandCount(running: number, total: number): string {
  return running > 0 ? `${running}/${total}` : String(total);
}

/**
 * Elapsed time between known endpoints, or live age when end is null and now is
 * supplied. The island uses createdAt -> now for agents, explicitly labelled
 * age: updatedAt is NOT a reliable execution end (it also changes on renames).
 * Commands use startedAt/finishedAt. Missing settled ends remain unknown.
 */
export function activityDuration(
  start: string,
  end: string | null,
  nowMs?: number,
): string {
  const from = Date.parse(start);
  const to = end === null ? nowMs : Date.parse(end);
  if (!Number.isFinite(from) || to === undefined || !Number.isFinite(to))
    return "—";
  const seconds = Math.floor(Math.max(0, to - from) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function commandFirstLine(command: string): string {
  return command.trim().split(/\r?\n/, 1)[0] || "(empty command)";
}
