import { MCP_SETTINGS_PAGE, type CatalogEntry } from "./mcp-catalog.js";
import type { McpAudience } from "./mcp-config.js";

/**
 * The conversation's resolved `mcpServers` settings: a decision per server name, and the highest
 * layer's `defaults` for a name that has none. A name neither decides follows the entry's own
 * `enabled`. `sources` names the layer that decided a server, when known.
 */
export type McpEnablement = {
  servers?: Readonly<Record<string, boolean>>;
  defaults?: boolean;
  sources?: Readonly<Record<string, string>>;
};

/** One quick_script run's view of MCP: its project and the conversation's enablement. */
export type McpRun = {
  projectId?: string;
  projectDirectory: string;
  enablement(): Promise<McpEnablement | undefined>;
};

/** The run of a conversation whose resolved settings are `settings`. */
export const mcpRunOf = (
  projectId: string,
  projectDirectory: string,
  settings: { mcpServers?: McpEnablement },
): McpRun => ({
  projectId,
  projectDirectory,
  enablement: async () => settings.mcpServers,
});

/** Why an entry may not run: switched off, or not (yet) approved. `undefined`: it may. */
export type McpBlock = "disabled" | "needs_review" | "declined";

export function mcpBlock(
  entry: CatalogEntry,
  enablement: McpEnablement | undefined,
): McpBlock | undefined {
  const enabled =
    enablement?.servers?.[entry.name] ??
    enablement?.defaults ??
    entry.server.config.enabled !== false;
  if (!enabled) return "disabled";
  return entry.review === "trusted" ? undefined : entry.review;
}

const LAYER_NAMES: Record<string, string> = {
  requirement: "the agent profile",
  recommendation: "the agent profile",
  conversation: "this conversation's MCP switch",
  launch: "the sub-agent's launch settings",
  process: "the process settings",
  project: "the project's agent settings",
  user: "the user's agent settings",
  builtin: "Nerve's built-in default",
  frozen: "the settings frozen when this sub-agent was created",
};

/** Where a server was turned off, when the resolution says; otherwise every place it can come from. */
function turnedOffBy(
  entry: CatalogEntry,
  enablement: McpEnablement | undefined,
): string {
  const decided =
    enablement?.servers?.[entry.name] ?? enablement?.defaults ?? undefined;
  if (decided === undefined) return '"enabled": false in the entry';
  const source = enablement?.sources?.[entry.name];
  if (source && LAYER_NAMES[source]) return LAYER_NAMES[source];
  return "an MCP switch of the conversation, the agent profile, the project's agent settings or the user's agent settings";
}

/**
 * The state and who acts, worded for its reader. The agent is told what to say to the user;
 * Settings speaks to the user directly (it is already on the page where they act).
 */
export function mcpBlockMessage(
  entry: CatalogEntry,
  block: McpBlock,
  enablement?: McpEnablement,
  audience: McpAudience = "agent",
): string {
  const page = MCP_SETTINGS_PAGE[entry.scope];
  if (audience === "user")
    switch (block) {
      case "disabled":
        return `Turned off by ${turnedOffBy(entry, enablement)}. Turn it on to use it.`;
      case "needs_review":
        return "Waiting for your approval. Review it to use it.";
      default:
        return "You declined this entry. Approve it to use it.";
    }
  switch (block) {
    case "disabled":
      return `Turned off by ${turnedOffBy(entry, enablement)}. The user turns it on in ${page}.`;
    case "needs_review":
      return `Waiting for the user's approval. The user reviews it in ${page}.`;
    default:
      return `The user declined this entry. It stays off until the user approves it in ${page}.`;
  }
}
