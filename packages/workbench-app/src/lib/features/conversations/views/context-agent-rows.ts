import type {
  AgentActivitySnapshot,
  AgentRecord,
} from "$lib/presentation/view-models/conversation";
import { shortAgentModel } from "$lib/domain/projects/project-tree";
import {
  relativeTimeLabel,
  dateTimeLabel,
} from "@nervekit/ui-kit/display/time";
import { permissionRuleSetLabel, shortAgentId } from "./context-session-fields";

/** Compact thinking-level suffix rendered next to the model. */
const THINKING_SHORT: Record<string, string> = {
  minimal: "min",
  low: "low",
  medium: "med",
  high: "high",
  xhigh: "xhi",
  max: "max",
};

/** Maximum words kept when deriving an explore name from its task text. */
const SHORT_TASK_WORDS = 6;

const TASK_VERB_PREFIX =
  /^(?:research|investigate|explore|find|look\s+into|trace|map|inspect|review)\b\s*:?\s*/i;

/** Clause boundaries; `.` only before whitespace so file names stay whole. */
const TASK_CLAUSE_BREAK = /[,:;]|\.(?:\s|$)|\s[—–-]\s|\s\(/;

export type AgentRole = "lead" | "teammate" | "explore";

/**
 * Conversation role. Only the explore tool spawns non-teammate children, so a
 * child without `executionKind` (older records) is an explore agent.
 */
export function agentRole(agent: AgentRecord): AgentRole {
  if (!agent.parentAgentId) return "lead";
  if (agent.executionKind === "async_developer") return "teammate";
  return "explore";
}

export function isAgentLive(
  agent: AgentRecord,
  activityById: Readonly<Record<string, AgentActivitySnapshot>> = {},
): boolean {
  const state = activityById[agent.id]?.state;
  return state === "running" || state === "awaiting_user";
}

function isAgentFailed(
  agent: AgentRecord,
  activityById: Readonly<Record<string, AgentActivitySnapshot>>,
): boolean {
  const state = activityById[agent.id]?.state;
  return state === "error" || state === "aborted";
}

export function agentRuleSetId(agent: AgentRecord): string {
  return agent.mode === "planning"
    ? "planning"
    : (agent.permissionRuleSetId ?? "");
}

/** Model plus thinking level, e.g. `gpt 5.6-luna (low)`. */
export function agentModelLabel(agent: AgentRecord): string {
  const model = shortAgentModel(agent);
  const thinking = THINKING_SHORT[agent.thinkingLevel ?? "off"];
  return thinking ? `${model} (${thinking})` : model;
}

function firstTaskLine(task: string | undefined): string | undefined {
  return task
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

/**
 * Short display name for explore agents recorded before explore labels were
 * persisted: drops a leading research verb, keeps the first clause, and caps
 * the word count.
 */
export function shortTaskLabel(task: string | undefined): string | undefined {
  const line = firstTaskLine(task);
  if (!line) return undefined;
  const clause = line.replace(TASK_VERB_PREFIX, "").split(TASK_CLAUSE_BREAK)[0];
  const words = clause?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (words.length === 0) return undefined;
  const kept = words.slice(0, SHORT_TASK_WORDS).join(" ");
  const label = words.length > SHORT_TASK_WORDS ? `${kept}…` : kept;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** First-view row text: the lead by role, subagents by a short name. */
export function agentRowLabel(agent: AgentRecord): string {
  const role = agentRole(agent);
  if (role === "lead") return "Lead agent";
  if (agent.name) return agent.name;
  if (role === "explore") return shortTaskLabel(agent.task) ?? "Explore agent";
  return firstTaskLine(agent.task) ?? "Subagent";
}

function byRecency(a: AgentRecord, b: AgentRecord): number {
  const updated = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  if (updated !== 0) return updated;
  return Date.parse(b.createdAt) - Date.parse(a.createdAt);
}

function attentionRank(
  agent: AgentRecord,
  activityById: Readonly<Record<string, AgentActivitySnapshot>>,
): number {
  const state = activityById[agent.id]?.state;
  if (state === "awaiting_user") return 0;
  if (state === "running") return 1;
  if (state === "awaiting_async") return 2;
  return 3;
}

export type AgentGroups = {
  lead?: AgentRecord;
  teammates: AgentRecord[];
  /** Running or waiting explore agents, always shown as rows. */
  exploreLive: AgentRecord[];
  /** Settled explore agents, folded behind one summary row. */
  exploreDone: AgentRecord[];
};

export function groupAgents(
  agents: readonly AgentRecord[],
  activeAgentId?: string,
  activityById: Readonly<Record<string, AgentActivitySnapshot>> = {},
): AgentGroups {
  const leads = agents.filter((agent) => agentRole(agent) === "lead");
  const explore = agents.filter((agent) => agentRole(agent) === "explore");
  return {
    lead: leads.find((agent) => agent.id === activeAgentId) ?? leads[0],
    teammates: agents
      .filter((agent) => agentRole(agent) === "teammate")
      .sort(
        (a, b) =>
          attentionRank(a, activityById) - attentionRank(b, activityById) ||
          byRecency(a, b),
      ),
    exploreLive: explore
      .filter((agent) => isAgentLive(agent, activityById))
      .sort(
        (a, b) =>
          attentionRank(a, activityById) - attentionRank(b, activityById) ||
          byRecency(a, b),
      ),
    exploreDone: explore
      .filter((agent) => !isAgentLive(agent, activityById))
      .sort(byRecency),
  };
}

export type AgentAttention = { needsYou: number; working: number };

export function agentAttention(
  agents: readonly AgentRecord[],
  activityById: Readonly<Record<string, AgentActivitySnapshot>> = {},
): AgentAttention {
  return {
    needsYou: agents.filter(
      (agent) => activityById[agent.id]?.state === "awaiting_user",
    ).length,
    working: agents.filter(
      (agent) => activityById[agent.id]?.state === "running",
    ).length,
  };
}

export type ExploreFoldSummary = {
  finished: number;
  failed: number;
  label: string;
};

export function exploreFoldSummary(
  done: readonly AgentRecord[],
  activityById: Readonly<Record<string, AgentActivitySnapshot>> = {},
): ExploreFoldSummary {
  const failed = done.filter((agent) =>
    isAgentFailed(agent, activityById),
  ).length;
  const finished = done.length - failed;
  const parts = [
    finished > 0 ? `${finished} finished` : undefined,
    failed > 0 ? `${failed} failed` : undefined,
  ].filter(Boolean);
  return { finished, failed, label: parts.join(" · ") };
}

export type AgentStatusBadge = {
  variant: "info" | "warning" | "destructive";
  text: string;
};

export function agentStatusBadge(
  agent: AgentRecord,
  activity?: AgentActivitySnapshot,
): AgentStatusBadge | undefined {
  if (activity?.state === "awaiting_user")
    return { variant: "warning", text: "needs you" };
  if (activity?.state === "running")
    return {
      variant: "info",
      text: agentRole(agent) === "explore" ? "running" : "working",
    };
  if (activity?.state === "awaiting_async")
    return { variant: "warning", text: "background work" };
  if (activity?.state === "error")
    return { variant: "destructive", text: "failed" };
  return undefined;
}

export type AgentDetailField = {
  label: string;
  value: string;
  title?: string;
  mono?: boolean;
};

/** Role word used as the detail popover's title. */
export function agentRoleLabel(agent: AgentRecord): string {
  const role = agentRole(agent);
  if (role === "lead") return "Lead agent";
  return role === "teammate" ? "Teammate" : "Explore agent";
}

export function agentStatusLabel(activity?: AgentActivitySnapshot): string {
  return (activity?.state ?? "idle").replaceAll("_", " ");
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
