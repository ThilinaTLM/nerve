import type {
  ConfigurationResource,
  ConfigurationResourceKind,
} from "@nervekit/contracts/configuration";
import { mcpItemId } from "$lib/application/mcp/mcp-item";

/** The two groups of the bell: items that wait for the user, and items that do not work. */
export type AttentionGroup = "review" | "broken";

/** A settings page in one of the two scopes; `item` opens a detail page. */
export type AttentionTarget = {
  scope: "user" | "project";
  pageId: string;
  item?: string;
};

export type AttentionEntry = {
  /** Stable across refreshes: the set signature and list keys use it. */
  key: string;
  group: AttentionGroup;
  kind: ConfigurationResourceKind;
  id: string;
  scope: "user" | "project";
  path?: string;
  title: string;
  /** Where it comes from, in the user's terms. */
  origin: string;
  /** The first diagnostic's own words, or what waits for the user. */
  detail: string;
  /** Where "Review" (waiting) or "Details" (not working) lands. */
  target?: AttentionTarget;
  /** The agent can repair it; it never approves anything. */
  askAgent?: "fix" | "upgrade";
  /** What the agent is given to work from; absent for items it cannot help with. */
  diagnostics: ConfigurationResource["diagnostics"];
};

const KIND_LABELS: Record<ConfigurationResourceKind, string> = {
  "agent-preferences": "Agent settings",
  "agent-profile": "Agent profile",
  "rule-set": "Permission rule set",
  "permission-overlay": "Permission rules",
  "launch-catalog": "Launch definitions",
  "mcp-servers": "MCP servers",
  skill: "Skill",
  "prompt-suggestion": "Suggestion",
  extension: "Extension",
};

/** Kinds whose id is the name of a file (`agent.json`), so the label alone says what it is. */
const FILE_KINDS = new Set<ConfigurationResourceKind>([
  "agent-preferences",
  "permission-overlay",
  "launch-catalog",
]);

export const PROJECT_ORIGIN = "In this project, from the repository";
export const USER_ORIGIN = "Yours, every project";

export function kindLabel(kind: ConfigurationResourceKind): string {
  return KIND_LABELS[kind];
}

function subject(resource: ConfigurationResource): string {
  // The `mcp.json` file itself, or one server in it.
  if (resource.kind === "mcp-servers")
    return resource.id === "mcp.json"
      ? KIND_LABELS[resource.kind]
      : `MCP server ${resource.id}`;
  return FILE_KINDS.has(resource.kind)
    ? KIND_LABELS[resource.kind]
    : `${KIND_LABELS[resource.kind]} ${resource.id}`;
}

function inScope(
  resource: ConfigurationResource,
): resource is ConfigurationResource & { scope: "user" | "project" } {
  return resource.scope === "user" || resource.scope === "project";
}

/** Waiting for the user, or not working. Warnings never qualify. */
export function attentionGroupOf(
  resource: ConfigurationResource,
): AttentionGroup | undefined {
  if (!inScope(resource)) return undefined;
  if (resource.state === "needs_review") return "review";
  if (
    resource.state === "invalid" ||
    resource.state === "incompatible" ||
    resource.diagnostics.some((diagnostic) => diagnostic.level === "error")
  )
    return "broken";
  return undefined;
}

/** Which of the two profile pages lists a profile; Agents when unknown. */
export type ProfilePageOf = (
  scope: "user" | "project",
  name: string,
) => "agents" | "sub-agents" | undefined;

/** The settings page where the item is decided or fixed, in the scope it belongs to. */
export function attentionTarget(
  resource: ConfigurationResource,
  group: AttentionGroup,
  profilePageOf?: ProfilePageOf,
): AttentionTarget | undefined {
  const scope = resource.scope === "project" ? "project" : "user";
  switch (resource.kind) {
    case "skill":
      // Only a skill that waits for approval has a review page; a broken one is not listed.
      return group === "review"
        ? {
            scope,
            pageId: "skills",
            item: `${scope}:${resource.id}`,
          }
        : { scope, pageId: "skills" };
    case "extension":
      return { scope, pageId: "extensions", item: resource.id };
    case "prompt-suggestion":
      return { scope, pageId: "suggestions" };
    case "launch-catalog":
      // Launches are edited in the Launches panel; the entry offers the file.
      return undefined;
    case "mcp-servers":
      // A server waiting for review opens its page; the file itself has no item.
      return group === "review" && resource.id !== "mcp.json"
        ? { scope, pageId: "mcp-servers", item: mcpItemId(scope, resource.id) }
        : { scope, pageId: "mcp-servers" };
    case "agent-profile": {
      // A profile waiting for review opens its own page, where it is decided.
      const pageId = profilePageOf?.(scope, resource.id) ?? "agents";
      return group === "review"
        ? { scope, pageId, item: `${scope}:${resource.id}` }
        : { scope, pageId };
    }
    case "rule-set":
    case "permission-overlay":
      return { scope, pageId: "permission-rules" };
    case "agent-preferences":
      return { scope, pageId: "general" };
  }
}

function reviewDetail(resource: ConfigurationResource): string {
  if (resource.kind === "skill")
    return resource.diagnostics.some(
      (diagnostic) => diagnostic.code === "approval-outdated",
    )
      ? "Changed since you trusted it. Not used until you trust it again."
      : "Not used until you trust it.";
  if (resource.kind === "extension") return "Not loaded until you allow it.";
  if (resource.kind === "mcp-servers") return "Not started until you trust it.";
  return "Ignored until you trust it.";
}

/** The entry for a resource, or undefined when it needs nobody. */
export function attentionEntry(
  resource: ConfigurationResource,
  profilePageOf?: ProfilePageOf,
): AttentionEntry | undefined {
  const group = attentionGroupOf(resource);
  if (!group || !inScope(resource)) return undefined;
  const label = subject(resource);
  const upgrade =
    resource.kind === "extension" && resource.state === "incompatible";
  const first = resource.diagnostics[0]?.message;
  const target = attentionTarget(resource, group, profilePageOf);
  return {
    key: [resource.kind, resource.scope, resource.id, resource.path ?? ""].join(
      "\u0000",
    ),
    group,
    kind: resource.kind,
    id: resource.id,
    scope: resource.scope,
    ...(resource.path ? { path: resource.path } : {}),
    title:
      group === "review"
        ? label
        : upgrade
          ? `${label} needs an upgrade`
          : `${label} can't load`,
    origin: resource.scope === "project" ? PROJECT_ORIGIN : USER_ORIGIN,
    // The diagnostic of a waiting item addresses the agent; the user reads this line.
    detail: group === "review" ? reviewDetail(resource) : (first ?? ""),
    ...(target ? { target } : {}),
    ...(group === "broken"
      ? { askAgent: upgrade ? ("upgrade" as const) : ("fix" as const) }
      : {}),
    diagnostics: resource.diagnostics,
  };
}

const normalizePath = (path: string) => path.replace(/[\\/]+$/, "");

/**
 * Entries for the registry's resources. A file the settings-health or
 * project-configuration-health entries already show is left to them.
 */
export function attentionEntries(
  resources: readonly ConfigurationResource[],
  alreadyShown: readonly string[] = [],
  profilePageOf?: ProfilePageOf,
): AttentionEntry[] {
  const shown = new Set(alreadyShown.map(normalizePath));
  const seen = new Set<string>();
  const entries: AttentionEntry[] = [];
  for (const resource of resources) {
    const entry = attentionEntry(resource, profilePageOf);
    if (!entry || seen.has(entry.key)) continue;
    if (
      entry.group === "broken" &&
      entry.path &&
      shown.has(normalizePath(entry.path))
    )
      continue;
    seen.add(entry.key);
    entries.push(entry);
  }
  return entries;
}

export function groupAttention(entries: readonly AttentionEntry[]): {
  review: AttentionEntry[];
  broken: AttentionEntry[];
} {
  return {
    review: entries.filter((entry) => entry.group === "review"),
    broken: entries.filter((entry) => entry.group === "broken"),
  };
}

/** Identifies the set; the toast fires when it changes. */
export function attentionSignature(entries: readonly AttentionEntry[]): string {
  return entries
    .map((entry) => `${entry.group}:${entry.key}`)
    .sort()
    .join(",");
}

export function attentionToastTitle(
  entries: readonly AttentionEntry[],
  projectName?: string,
): string {
  const { review, broken } = groupAttention(entries);
  const parts: string[] = [];
  const upgrades = broken.filter((entry) => entry.askAgent === "upgrade");
  if (review.length)
    parts.push(
      `${projectName ? `${projectName} has ` : ""}${review.length} ${review.length === 1 ? "item" : "items"} waiting for your review`,
    );
  if (upgrades.length)
    parts.push(
      `${upgrades.length} ${upgrades.length === 1 ? "extension needs" : "extensions need"} an upgrade`,
    );
  const other = broken.length - upgrades.length;
  if (other)
    parts.push(`${other} ${other === 1 ? "item doesn't" : "items don't"} work`);
  return parts.join(" · ");
}

/** Project items that wait for the user's decision and have a page to decide them on. */
export function projectReviewEntries(
  entries: readonly AttentionEntry[],
): AttentionEntry[] {
  return entries.filter(
    (entry) =>
      entry.group === "review" && entry.scope === "project" && entry.target,
  );
}

/** The welcome's one-line reminder of a project's undecided items. */
export function reviewReminder(count: number): string {
  return count === 1
    ? "1 project file needs your review"
    : `${count} project files need your review`;
}

/** Counts of entries waiting for review per settings page, by scope; broken items and entries without a page count nowhere. */
export function attentionCounts(entries: readonly AttentionEntry[]): {
  project: number;
  user: number;
  pages: Record<"user" | "project", Record<string, number>>;
} {
  const pages: Record<"user" | "project", Record<string, number>> = {
    user: {},
    project: {},
  };
  const waiting = entries.filter((entry) => entry.group === "review");
  for (const entry of waiting) {
    if (!entry.target) continue;
    const bucket = pages[entry.target.scope];
    bucket[entry.target.pageId] = (bucket[entry.target.pageId] ?? 0) + 1;
  }
  return {
    project: waiting.filter((entry) => entry.scope === "project").length,
    user: waiting.filter((entry) => entry.scope === "user").length,
    pages,
  };
}

/** The prompt that starts the Forge conversation; it names the item and grants nothing. */
export function askAgentPrompt(entry: AttentionEntry): string {
  const lines = [
    entry.askAgent === "upgrade"
      ? "Upgrade this configuration so it works with the current version of Nerve."
      : "Fix this configuration so it loads.",
    "",
    `Kind: ${kindLabel(entry.kind)} (${entry.kind})`,
    `Id: ${entry.id}`,
    `Scope: ${entry.scope === "project" ? "project (from the repository)" : "user (every project)"}`,
    ...(entry.path ? [`Path: ${entry.path}`] : []),
    "Problems:",
    ...entry.diagnostics.map(
      (diagnostic) =>
        `- [${diagnostic.level}] ${diagnostic.code}: ${diagnostic.message}${diagnostic.pointer ? ` (${diagnostic.pointer})` : ""}`,
    ),
    "",
    "Do not approve or trust anything; I review that myself.",
  ];
  return lines.join("\n");
}
