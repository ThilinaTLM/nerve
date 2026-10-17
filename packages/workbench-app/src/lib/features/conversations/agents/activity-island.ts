import type { AsyncBash } from "@nervekit/contracts/core";
import { compareSubagents } from "$lib/presentation/conversations/subagent-order";
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
  viewed: boolean;
};

/** Rows shown before older settled items fold behind one disclosure row. */
export const ISLAND_VISIBLE_ROWS = 6;

export type IslandFold<T> = {
  /** Ordered prefix, extended when needed to keep live/viewed items visible. */
  rows: T[];
  /** Overflow of older settled items; empty unless the list is long. */
  folded: T[];
  running: number;
  total: number;
};

const SETTLED_AGENT: ReadonlySet<AgentRowState> = new Set([
  "idle",
  "stopped",
  "failed",
]);

function timestamp(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Fold only an ordered suffix. Extend the visible prefix through every pinned
 * item (live, needing attention, viewed), without promoting it above newer
 * prompts. Never hide a single overflow item behind a group of one.
 */
function fold<T>(
  items: readonly T[],
  pinned: (item: T) => boolean,
): Pick<IslandFold<T>, "rows" | "folded"> {
  const budget = Math.max(ISLAND_VISIBLE_ROWS, items.findLastIndex(pinned) + 1);
  if (items.length - budget <= 1) return { rows: [...items], folded: [] };
  return { rows: items.slice(0, budget), folded: items.slice(budget) };
}

/** All retained children; the lead is navigation, not a row. */
export function islandAgents(
  agents: readonly AgentRecord[],
  activities: Readonly<Record<string, AgentActivitySnapshot>>,
  viewedId: string,
): IslandFold<IslandAgentRow> & { leadId?: string } {
  const all = agents
    .filter((agent) => Boolean(agent.parentAgentId))
    .map((agent): IslandAgentRow => {
      const state = agentRowState(activities[agent.id]);
      return {
        agent,
        name: agent.name?.trim() || "Sub-agent",
        profile: subagentProfileLabel(agent),
        state,
        viewed: agent.id === viewedId,
      };
    })
    .sort((a, b) => compareSubagents(a.agent, b.agent));
  return {
    leadId: agents.find((agent) => !agent.parentAgentId)?.id,
    ...fold(all, (row) => row.viewed || !SETTLED_AGENT.has(row.state)),
    running: all.filter((row) => row.state === "working").length,
    total: all.length,
  };
}

/** Every running command plus the five most recently settled, independent of input order. */
export function islandCommands(
  commands: readonly AsyncBash[],
): IslandFold<AsyncBash> {
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
  return {
    ...fold(
      [...running, ...settled],
      (command) => command.status === "running",
    ),
    running: running.length,
    // Count only accessible rows; older settled commands have no history UI.
    total: running.length + settled.length,
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

export function commandFirstLine(command: string): string {
  return command.trim().split(/\r?\n/, 1)[0] || "(empty command)";
}
