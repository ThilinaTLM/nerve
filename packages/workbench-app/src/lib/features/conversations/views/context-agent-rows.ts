import type { AgentRecord } from "$lib/api";
import { shortAgentModel } from "$lib/domain/projects/project-tree";
import {
  relativeTimeLabel,
  dateTimeLabel,
} from "@nervekit/ui-kit/display/time";
import { permissionRuleSetLabel, shortAgentId } from "./context-session-fields";

/** Rows shown before the list collapses behind "Show all". */
export const COLLAPSED_AGENT_ROWS = 6;

/** Compact thinking-level suffix rendered next to the model. */
const THINKING_SHORT: Record<string, string> = {
  minimal: "min",
  low: "low",
  medium: "med",
  high: "high",
  xhigh: "xhi",
  max: "max",
};

export function isAgentLive(agent: AgentRecord): boolean {
  return agent.status === "running" || agent.status === "awaiting_user";
}

export function agentRuleSetId(agent: AgentRecord): string {
  return agent.mode === "planning"
    ? "planning"
    : (agent.permissionRuleSetId ?? agent.permissionLevel);
}

/** Model plus thinking level, e.g. `gpt 5.6-luna (low)`. */
export function agentModelLabel(agent: AgentRecord): string {
  const model = shortAgentModel(agent);
  const thinking = THINKING_SHORT[agent.thinkingLevel ?? "off"];
  return thinking ? `${model} (${thinking})` : model;
}

/**
 * First-view row text: what the agent is doing. The main agent has no task, so
 * it identifies itself by role instead.
 */
export function agentRowLabel(agent: AgentRecord): string {
  if (!agent.parentAgentId) return "Main agent";
  const firstLine = agent.task
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine ?? "Subagent";
}

export function sortAgents(
  agents: readonly AgentRecord[],
  activeAgentId?: string,
): AgentRecord[] {
  return [...agents].sort((a, b) => {
    const aMain = a.parentAgentId ? 0 : 1;
    const bMain = b.parentAgentId ? 0 : 1;
    if (aMain !== bMain) return bMain - aMain;

    const aSelected = a.id === activeAgentId ? 1 : 0;
    const bSelected = b.id === activeAgentId ? 1 : 0;
    if (aSelected !== bSelected) return bSelected - aSelected;

    const aLive = isAgentLive(a) ? 1 : 0;
    const bLive = isAgentLive(b) ? 1 : 0;
    if (aLive !== bLive) return bLive - aLive;

    const aUpdated = new Date(a.updatedAt).getTime();
    const bUpdated = new Date(b.updatedAt).getTime();
    if (aUpdated !== bUpdated) return bUpdated - aUpdated;

    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export type VisibleAgents = {
  rows: AgentRecord[];
  hiddenCount: number;
};

/**
 * Collapsed view keeps the agents a reader still needs — the main agent, live
 * agents, and the selected one — and fills the rest of the budget with the most
 * recent rows in sort order.
 */
export function visibleAgents(
  sorted: readonly AgentRecord[],
  options: {
    activeAgentId?: string;
    expanded?: boolean;
    limit?: number;
  } = {},
): VisibleAgents {
  const {
    activeAgentId,
    expanded = false,
    limit = COLLAPSED_AGENT_ROWS,
  } = options;
  if (expanded) return { rows: [...sorted], hiddenCount: 0 };

  const pinned = new Set(
    sorted
      .filter(
        (agent) =>
          !agent.parentAgentId ||
          isAgentLive(agent) ||
          agent.id === activeAgentId,
      )
      .map((agent) => agent.id),
  );

  let budget = Math.max(limit - pinned.size, 0);
  const rows = sorted.filter((agent) => {
    if (pinned.has(agent.id)) return true;
    if (budget === 0) return false;
    budget -= 1;
    return true;
  });

  return { rows, hiddenCount: sorted.length - rows.length };
}

export function liveAgentCount(agents: readonly AgentRecord[]): number {
  return agents.filter(isAgentLive).length;
}

export type AgentDetailField = {
  label: string;
  value: string;
  title?: string;
  mono?: boolean;
};

/** Role word used as the detail popover's title. */
export function agentRoleLabel(agent: AgentRecord): string {
  return agent.parentAgentId ? "Subagent" : "Main agent";
}

export function agentStatusLabel(agent: AgentRecord): string {
  return agent.status.replaceAll("_", " ");
}

/**
 * Configuration the first view drops. Role and status are the popover's title
 * and badge, so they are not repeated here.
 */
export function agentDetailFields(agent: AgentRecord): AgentDetailField[] {
  const model = agent.model
    ? `${agent.model.provider}/${agent.model.modelId}`
    : "Pending";
  return [
    { label: "Model", value: model, title: model },
    {
      label: "Thinking",
      value:
        agent.thinkingLevel && agent.thinkingLevel !== "off"
          ? agent.thinkingLevel
          : "Off",
    },
    { label: "Mode", value: agent.mode === "planning" ? "Planning" : "Coding" },
    { label: "Rule set", value: permissionRuleSetLabel(agentRuleSetId(agent)) },
    {
      label: "Depth",
      value: agent.budget
        ? `${agent.budget.depth} / ${agent.budget.maxDepth}`
        : "—",
    },
    {
      label: "Started",
      value: relativeTimeLabel(agent.createdAt) || "—",
      title: dateTimeLabel(agent.createdAt),
    },
    {
      label: "Updated",
      value: relativeTimeLabel(agent.updatedAt) || "—",
      title: dateTimeLabel(agent.updatedAt),
    },
    {
      label: "Agent",
      value: shortAgentId(agent.id),
      title: agent.id,
      mono: true,
    },
  ];
}
