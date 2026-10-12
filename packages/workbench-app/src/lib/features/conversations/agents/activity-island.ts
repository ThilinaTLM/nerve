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
  viewed: boolean;
};

/** Rows shown before older settled items fold behind one disclosure row. */
export const ISLAND_VISIBLE_ROWS = 6;

export type IslandFold<T> = {
  /** Live items always, then the newest settled items within the budget. */
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

/**
 * Split pre-sorted items by count, not age: pinned items (live, needing
 * attention, viewed) never fold, settled items fill the remaining budget, and
 * a single overflow item is shown rather than hidden behind a group of one.
 */
function fold<T>(
  items: readonly T[],
  pinned: (item: T) => boolean,
): Pick<IslandFold<T>, "rows" | "folded"> {
  const budget = Math.max(
    0,
    ISLAND_VISIBLE_ROWS - items.filter((item) => pinned(item)).length,
  );
  const overflow =
    items.length - items.filter((item) => pinned(item)).length - budget;
  if (overflow <= 1) return { rows: [...items], folded: [] };
  const rows: T[] = [];
  const folded: T[] = [];
  let settled = 0;
  for (const item of items) {
    if (pinned(item) || settled++ < budget) rows.push(item);
    else folded.push(item);
  }
  return { rows, folded };
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
    .sort(
      (a, b) =>
        rank[a.state] - rank[b.state] ||
        timestamp(b.agent.updatedAt) - timestamp(a.agent.updatedAt) ||
        a.agent.id.localeCompare(b.agent.id),
    );
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
