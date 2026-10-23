import type { CapabilityToolName } from "@nervekit/contracts/capabilities";
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
