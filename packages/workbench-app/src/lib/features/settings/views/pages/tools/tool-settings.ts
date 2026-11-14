import type { CapabilityToolName } from "@nervekit/contracts/capabilities";
export type ToolId = CapabilityToolName;

/** The editable shape shared by every tool: all fields optional. */
export type ToolPayload = {
  enabled?: boolean;
  settings?: Record<string, unknown>;
};

export type ToolRowDef = {
  id: ToolId;
  label: string;
  description: string;
  /** Always on: only its configuration is offered. */
  always?: boolean;
  /** Has a Configure dialog; otherwise its setup lives in an extension. */
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
    configurable: false,
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
    id: "quick_script",
    label: "Quick script",
    description:
      "Run short TypeScript scripts that call the enabled extensions (Jira, Confluence, web, diagrams, images) and document utilities.",
    configurable: false,
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

/** Account kinds the user manages in an extension's Accounts section. */
export type AccountKind = "tavily" | "atlassian";

/** Every account the user can pick from, by kind. */
export type AccountOptions = Record<AccountKind, AccountOption[]>;
export function accountOptions(
  providers:
    | {
        tavilyProfiles: AccountOption[];
        atlassianProfiles: { id: string; name: string; siteUrl?: string }[];
      }
    | undefined,
): AccountOptions {
  return {
    tavily: providers?.tavilyProfiles ?? [],
    atlassian: (providers?.atlassianProfiles ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      detail: p.siteUrl,
    })),
  };
}

export type ToolDisplayContext = {
  profileLabel: (name: string) => string;
  modelLabel: (selection: unknown) => string | undefined;
};

function onOff(payload: ToolPayload): string {
  return payload.enabled ? "On" : "Off";
}

/** One short line: "On · account: Work", "/bin/bash · timeout 900 s". */
/** How a tool is set up, without its on/off state (the switch shows that). */
export function toolSettingsSummary(
  id: ToolId,
  payload: ToolPayload,
  context: ToolDisplayContext,
): string | undefined {
  const s = (payload.settings ?? {}) as Record<string, unknown>;
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
      return `${(s.interpreterPath as string | undefined) ?? "auto-detect"}`;
    case "explain_image":
      return `${context.modelLabel(s.model) ?? "no model"}`;
    case "plan_present":
      return `after approval: ${context.profileLabel(String(s.approvalProfile ?? ""))}`;
    default:
      return undefined;
  }
}

/** On/off plus the settings, for change descriptions and profile summaries. */
export function toolSummary(
  id: ToolId,
  payload: ToolPayload,
  context: ToolDisplayContext,
): string {
  const settings = toolSettingsSummary(id, payload, context);
  return id === "bash"
    ? (settings ?? "")
    : [onOff(payload), settings].filter(Boolean).join(" · ");
}
