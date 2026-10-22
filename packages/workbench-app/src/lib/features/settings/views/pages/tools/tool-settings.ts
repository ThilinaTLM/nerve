/**
 * The Tools page's model. Every optional tool, and bash's configuration, is
 * edited as one canonical capability payload (`enabled`, `profileId`,
 * `settings`) at both levels: user settings project into payloads and back
 * into a `settings.update` patch; project settings are the capability layer
 * and need no translation. The same payloads are what profile templates and
 * conversations carry.
 */
import {
  capabilityToolPayload,
  type CapabilityConfiguration,
  type CapabilityPatch,
  type CapabilityToolName,
} from "@nervekit/contracts/capabilities";
import type { UpdateSettingsRequest, Settings } from "$lib/api";
import { subagentToolNames } from "@nervekit/contracts/tools";

export type ToolId = CapabilityToolName;

/** The editable shape shared by every tool: all fields optional. */
export type ToolPayload = {
  enabled?: boolean;
  profileId?: string;
  settings?: Record<string, unknown>;
};

export type ToolRowDef = {
  id: ToolId;
  label: string;
  description: string;
  /** Always on: only its configuration is offered. */
  always?: boolean;
  /** Has a Configure dialog. */
  configurable: boolean;
};

export const toolRows: readonly ToolRowDef[] = [
  {
    id: "bash",
    label: "Bash",
    description: "Run shell commands in the foreground or background.",
    always: true,
    configurable: true,
  },
  {
    id: "python_exec",
    label: "Python",
    description: "Run short Python scripts or files for data work.",
    configurable: true,
  },
  {
    id: "web_search",
    label: "Web search",
    description: "Search the web through Tavily.",
    configurable: true,
  },
  {
    id: "web_fetch",
    label: "Web fetch",
    description: "Fetch a URL as readable markdown.",
    configurable: false,
  },
  {
    id: "explain_image",
    label: "Image explanation",
    description: "A vision model explains images to text-only agents.",
    configurable: true,
  },
  {
    id: "generate_image",
    label: "Image generation",
    description: "Generate images.",
    configurable: true,
  },
  {
    id: "kroki_export",
    label: "Diagram export",
    description: "Render diagrams to SVG or PNG with Kroki.",
    configurable: true,
  },
  {
    id: "jira",
    label: "Jira",
    description: "Search and manage Jira Cloud issues.",
    configurable: true,
  },
  {
    id: "confluence",
    label: "Confluence",
    description: "Search and manage Confluence Cloud content.",
    configurable: true,
  },
  {
    id: "plan_present",
    label: "Plan review",
    description: "Submit a plan for your review before changes.",
    configurable: true,
  },
  {
    id: "subagents",
    label: "Sub-agents",
    description: "Let the main agent delegate to sub-agent profiles.",
    configurable: false,
  },
];

export function toolRow(id: ToolId): ToolRowDef {
  const row = toolRows.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`Unknown tool ${id}`);
  return row;
}

export type AccountOption = { id: string; name: string; detail?: string };

/** Tools whose account is chosen from the user's integration accounts. */
export type AccountKind = "tavily" | "atlassian";
export function accountKind(id: ToolId): AccountKind | undefined {
  if (id === "web_search") return "tavily";
  return id === "jira" || id === "confluence" ? "atlassian" : undefined;
}

// ---- user settings <-> payload ---------------------------------------------

type DisabledName = Settings["tools"]["disabled"][number];
type Loose = Record<string, unknown>;

export function userToolPayload(settings: Settings, id: ToolId): ToolPayload {
  const tools = settings.tools;
  const disabled = new Set<string>(tools.disabled);
  const enabled = !disabled.has(id);
  switch (id) {
    case "bash":
      return { settings: { ...tools.bash } };
    case "python_exec":
      return { enabled, settings: { ...tools.pythonExec } };
    case "web_search":
      return { enabled, profileId: tools.web.tavilyProfileId };
    case "web_fetch":
      return { enabled };
    case "explain_image":
      return { enabled, settings: { ...tools.imageExplanation } };
    case "generate_image":
      return { enabled, settings: { ...tools.imageGeneration } };
    case "kroki_export":
      return { enabled, settings: { ...tools.kroki } };
    case "jira":
      return { enabled: tools.jira.enabled, profileId: tools.jira.profileId };
    case "confluence":
      return {
        enabled: tools.confluence.enabled,
        profileId: tools.confluence.profileId,
      };
    case "plan_present":
      return { enabled, settings: { ...tools.planPresent } };
    case "subagents":
      return { enabled: !subagentToolNames.some((name) => disabled.has(name)) };
  }
}

const disabledOrder: DisabledName[] = [
  ...subagentToolNames,
  "plan_present",
  "web_search",
  "web_fetch",
  "explain_image",
  "generate_image",
  "kroki_export",
  "python_exec",
];

function disabledList(
  settings: Settings,
  id: ToolId,
  enabled: boolean,
): DisabledName[] {
  const names: string[] = id === "subagents" ? [...subagentToolNames] : [id];
  const next = new Set<string>(settings.tools.disabled);
  for (const name of names) {
    if (enabled) next.delete(name);
    else next.add(name);
  }
  return disabledOrder.filter((name) => next.has(name));
}

function usesDisabledList(id: ToolId): boolean {
  return id !== "bash" && id !== "jira" && id !== "confluence";
}

/** The `settings.update` patch that makes `next` the user's value. */
export function userToolPatch(
  settings: Settings,
  id: ToolId,
  next: ToolPayload,
): UpdateSettingsRequest {
  const tools: NonNullable<UpdateSettingsRequest["tools"]> = {};
  if (usesDisabledList(id) && next.enabled !== undefined)
    tools.disabled = disabledList(settings, id, next.enabled);
  const s = next.settings as Loose | undefined;
  switch (id) {
    case "bash":
      if (s) tools.bash = s as never;
      break;
    case "python_exec":
      if (s)
        tools.pythonExec = {
          interpreterPath: (s.interpreterPath as string | undefined) ?? null,
        };
      break;
    case "web_search":
      tools.web = { tavilyProfileId: next.profileId ?? null };
      break;
    case "explain_image":
      if (s)
        tools.imageExplanation = {
          model: (s.model as never) ?? null,
          thinkingLevel: s.thinkingLevel as never,
        };
      break;
    case "generate_image":
      if (s) tools.imageGeneration = s as never;
      break;
    case "kroki_export":
      if (s) tools.kroki = s as never;
      break;
    case "jira":
    case "confluence":
      tools[id] = { enabled: next.enabled, profileId: next.profileId ?? null };
      break;
    case "plan_present":
      if (s) tools.planPresent = s as never;
      break;
  }
  return { tools };
}

/** Applies `next` to the local draft so the page reflects it before the save lands. */
export function applyUserToolDraft(
  settings: Settings,
  id: ToolId,
  next: ToolPayload,
): void {
  const tools = settings.tools;
  const s = next.settings as Loose | undefined;
  if (usesDisabledList(id) && next.enabled !== undefined)
    tools.disabled = disabledList(settings, id, next.enabled);
  switch (id) {
    case "bash":
      if (s) tools.bash = s as never;
      break;
    case "python_exec":
      if (s) tools.pythonExec = { ...s } as never;
      break;
    case "web_search":
      tools.web.tavilyProfileId = next.profileId;
      break;
    case "explain_image":
      if (s) tools.imageExplanation = s as never;
      break;
    case "generate_image":
      if (s) tools.imageGeneration = s as never;
      break;
    case "kroki_export":
      if (s) tools.kroki = s as never;
      break;
    case "jira":
    case "confluence":
      tools[id] = { enabled: next.enabled ?? false, profileId: next.profileId };
      break;
    case "plan_present":
      if (s) tools.planPresent = s as never;
      break;
  }
}

// ---- project capability layer ------------------------------------------------

export function projectToolPayload(
  selection: CapabilityConfiguration["effective"],
  id: ToolId,
): ToolPayload {
  return capabilityToolPayload(selection, id) as ToolPayload;
}

/** Does this project's layer change the tool relative to the user's value? */
export function projectToolChanged(
  configuration: CapabilityConfiguration,
  id: ToolId,
): boolean {
  return id in configuration.project.tools;
}

/** Sets every field of `next` on the project layer; the server drops what equals the inherited value. */
export function projectToolPatch(
  id: ToolId,
  next: ToolPayload,
): CapabilityPatch {
  const entry: Loose = {};
  if (id !== "bash" && next.enabled !== undefined) entry.enabled = next.enabled;
  if (accountKind(id)) entry.profileId = next.profileId ?? null;
  if (next.settings !== undefined) entry.settings = next.settings;
  return { tools: { [id]: entry } } as CapabilityPatch;
}

export function projectToolResetPatch(id: ToolId): CapabilityPatch {
  return { tools: { [id]: null } } as CapabilityPatch;
}

// ---- display -------------------------------------------------------------------

export type ToolDisplayContext = {
  accountName: (
    kind: AccountKind,
    id: string | undefined,
  ) => string | undefined;
  profileLabel: (name: string) => string;
  modelLabel: (selection: unknown) => string | undefined;
};

function onOff(payload: ToolPayload): string {
  return payload.enabled ? "On" : "Off";
}

/** One short line: "On · account: Work", "/bin/bash · timeout 900 s". */
export function toolSummary(
  id: ToolId,
  payload: ToolPayload,
  context: ToolDisplayContext,
): string {
  const s = (payload.settings ?? {}) as Loose;
  switch (id) {
    case "bash": {
      const auto = (s.autoPromotion ?? {}) as {
        enabled?: boolean;
        afterMs?: number;
      };
      return [
        (s.shellPath as string | undefined) ?? "default shell",
        auto.enabled
          ? `background after ${Number(auto.afterMs) / 1000} s`
          : `timeout ${Number(s.maxTimeoutMs ?? 0) / 1000} s`,
      ].join(" · ");
    }
    case "python_exec":
      return `${onOff(payload)} · ${(s.interpreterPath as string | undefined) ?? "auto-detect"}`;
    case "web_search":
    case "jira":
    case "confluence": {
      const name = context.accountName(accountKind(id)!, payload.profileId);
      return `${onOff(payload)} · ${name ? `account: ${name}` : "no account"}`;
    }
    case "explain_image":
      return `${onOff(payload)} · ${context.modelLabel(s.model) ?? "no model"}`;
    case "generate_image":
      return `${onOff(payload)} · ${String(s.model ?? "")}`;
    case "kroki_export":
      return `${onOff(payload)} · ${String(s.url ?? "").replace(/^https?:\/\//, "")}`;
    case "plan_present":
      return `${onOff(payload)} · after approval: ${context.profileLabel(String(s.approvalProfile ?? ""))}`;
    default:
      return onOff(payload);
  }
}
