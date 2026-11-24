import type { SettingsScopeTarget } from "./settings-scope";

/**
 * Page ids, labels, sections and nav grouping as plain data. Icons are attached
 * in `settings-pages.ts`; keeping this file free of components lets guards and
 * tests read the page contract without a Svelte compiler.
 */
export type SettingsScopeKind = SettingsScopeTarget["kind"];

export type PageData = {
  label: string;
  description?: string;
  sections: { id: string; label: string }[];
  /**
   * The page drills into one item (`Page › Item`). `param` names the item
   * (e.g. "extension"); the item ids come from the page's own data.
   */
  detail?: { param: string };
};

const providers: PageData = {
  label: "Providers",
  description:
    "Where Nerve gets its models: subscriptions, API keys and custom endpoints.",
  sections: [
    { id: "subscriptions", label: "Subscriptions" },
    { id: "api-keys", label: "API keys" },
    { id: "custom-providers", label: "Custom providers" },
    { id: "custom-models", label: "Custom models" },
  ],
};
const extensions: PageData = {
  label: "Extensions",
  description: "Open an extension to set it up and add the accounts it uses.",
  sections: [{ id: "builtin", label: "Built-in" }],
  detail: { param: "extension" },
};
const accounts: PageData = {
  label: "Accounts",
  description: "Credentials extensions use to reach other services.",
  sections: [{ id: "accounts", label: "Accounts" }],
};
const general: PageData = {
  label: "General",
  description: "Defaults for new conversations. Projects can override them.",
  sections: [
    { id: "new-conversations", label: "New conversations" },
    { id: "model", label: "Model" },
    { id: "compaction", label: "Compaction" },
  ],
};
const tools: PageData = {
  label: "Tools",
  description: "What the agent can use, grouped by where each tool comes from.",
  sections: [{ id: "tools", label: "Tools" }],
};
const skills: PageData = {
  label: "Skills",
  description:
    "Grouped by where each skill comes from. A project skill replaces one of yours with the same name.",
  sections: [{ id: "skills", label: "Skills" }],
};
const agents: PageData = {
  label: "Agents",
  description:
    "Profiles that set a conversation's model, tools and instructions. Edits don't change conversations already started.",
  sections: [{ id: "agents", label: "Agents" }],
  detail: { param: "profile" },
};
const subAgents: PageData = {
  label: "Sub-Agents",
  description:
    "Profiles the lead agent can delegate to. Edits don't change sub-agents already started.",
  sections: [{ id: "sub-agents", label: "Sub-Agents" }],
  detail: { param: "profile" },
};
const permissionRules: PageData = {
  label: "Permission rules",
  description:
    "Rule sets decide which tool calls are allowed, asked about or blocked.",
  sections: [{ id: "rule-sets", label: "Rule sets" }],
  detail: { param: "rule-set" },
};
const models: PageData = {
  label: "Models",
  description: "Choose which models the composer offers.",
  sections: [{ id: "models", label: "Models" }],
};
const suggestions: PageData = {
  label: "Suggestions",
  description:
    "Prompts offered in the composer. A project suggestion replaces one with the same name.",
  sections: [{ id: "suggestions", label: "Suggestions" }],
  detail: { param: "suggestion" },
};

const userPages: Record<string, PageData> = {
  providers,
  extensions,
  accounts,
  general,
  tools,
  skills,
  agents,
  "sub-agents": subAgents,
  "permission-rules": permissionRules,
  models,
  workbench: {
    label: "Workbench",
    description: "How Nerve looks and behaves on this computer.",
    sections: [
      { id: "appearance", label: "Appearance" },
      { id: "desktop", label: "Desktop" },
    ],
  },
  notifications: {
    label: "Notifications",
    description: "When and how Nerve alerts you.",
    sections: [
      { id: "general", label: "General" },
      { id: "sounds", label: "Sounds" },
    ],
  },
  shortcuts: {
    label: "Shortcuts",
    description: "Fixed keys; the primary modifier follows your platform.",
    sections: [{ id: "shortcuts", label: "Shortcuts" }],
  },
  titles: {
    label: "Titles",
    description: "Name new conversations with a small model.",
    sections: [
      { id: "ai-titles", label: "AI titles" },
      { id: "test", label: "Test" },
    ],
  },
  voice: {
    label: "Voice",
    description: "The OpenAI model and context hints used for voice input.",
    sections: [
      { id: "model", label: "Model" },
      { id: "context", label: "Context" },
    ],
  },
  suggestions,
  storage: {
    label: "Storage",
    description: "What Nerve keeps on this computer, and how to free space.",
    sections: [{ id: "storage", label: "Storage" }],
  },
  "background-jobs": {
    label: "Background jobs",
    description:
      "Work Nerve does on its own. A job that keeps failing shows in the notification bell.",
    sections: [{ id: "jobs", label: "Jobs" }],
  },
  remote: {
    label: "Remote connections",
    description: "Open Nerve from your phone or another computer.",
    sections: [
      { id: "tailscale", label: "Tailscale" },
      { id: "local-network", label: "Same network" },
    ],
  },
  devices: {
    label: "Devices",
    description:
      "Browsers and phones that can open this Nerve, and how they sign in.",
    sections: [
      { id: "devices", label: "Devices" },
      { id: "passkeys", label: "Passkeys" },
      { id: "activity", label: "Recent activity" },
    ],
  },
  system: {
    label: "System",
    description: "Listener, diagnostics and daemon controls.",
    sections: [
      { id: "network", label: "Listener" },
      { id: "diagnostics", label: "Diagnostics" },
      { id: "resource-concurrency", label: "Resource concurrency" },
      { id: "daemon", label: "Daemon" },
      { id: "desktop-rendering", label: "Desktop rendering" },
      { id: "launch-context", label: "Launch context" },
      { id: "system-information", label: "System information" },
    ],
  },
};

const projectPages: Record<string, PageData> = {
  general: {
    ...general,
    description:
      "Overrides for this project; anything unset follows your user settings.",
  },
  tools,
  // A project skill opens its review page; user skills have none.
  skills: { ...skills, detail: { param: "skill" } },
  extensions: {
    ...extensions,
    description:
      "Overrides for this project; anything unset follows your user settings.",
  },
  agents: {
    ...agents,
    description:
      "Profiles stored in this project, shared with everyone who opens the repo.",
  },
  "sub-agents": {
    ...subAgents,
    description:
      "Sub-agent profiles stored in this project, shared with everyone who opens the repo.",
  },
  "permission-rules": permissionRules,
  launch: {
    label: "Launch",
    description:
      "Saved commands, such as a dev server, started from the Launches panel.",
    sections: [{ id: "launch", label: "Launch" }],
  },
  "instructions-files": {
    label: "Instructions files",
    description: "Files Nerve adds to the system prompt in this project.",
    sections: [
      { id: "agents-md", label: "AGENTS.md" },
      { id: "append-system", label: "Append system" },
    ],
  },
  suggestions,
  trust: {
    label: "Trust",
    description:
      "Project files Nerve uses only after you review them. Trust covers the exact content you reviewed.",
    sections: [
      { id: "trust", label: "Trust" },
      { id: "profile-files", label: "Profile files" },
    ],
  },
};

export const pagesByScope: Record<
  SettingsScopeKind,
  Record<string, PageData>
> = {
  user: userPages,
  project: projectPages,
};

export type NavLayout = readonly {
  id: string;
  title: string;
  pages: string[];
}[];

const userLayout: NavLayout = [
  {
    id: "connections",
    title: "Connections",
    pages: ["providers", "extensions", "accounts"],
  },
  { id: "agent", title: "Agent", pages: ["general", "tools", "skills"] },
  {
    id: "catalog",
    title: "Catalog",
    pages: [
      "agents",
      "sub-agents",
      "permission-rules",
      "models",
      "suggestions",
    ],
  },
  {
    id: "app",
    title: "App",
    pages: ["workbench", "notifications", "shortcuts", "voice", "titles"],
  },
  {
    id: "system",
    title: "System",
    pages: ["storage", "background-jobs", "remote", "devices", "system"],
  },
];

const projectLayout: NavLayout = [
  {
    id: "agent",
    title: "Agent",
    pages: ["general", "tools", "skills", "extensions"],
  },
  {
    id: "catalog",
    title: "Catalog",
    pages: ["agents", "sub-agents", "permission-rules", "suggestions"],
  },
  {
    id: "this-project",
    title: "This project",
    pages: ["launch", "instructions-files", "trust"],
  },
];

export const layoutByScope: Record<SettingsScopeKind, NavLayout> = {
  user: userLayout,
  project: projectLayout,
};

/** Page ids in nav order. */
export function settingsPageIds(kind: SettingsScopeKind): string[] {
  return layoutByScope[kind].flatMap((group) => group.pages);
}

export function defaultSettingsPageId(kind: SettingsScopeKind): string {
  return settingsPageIds(kind)[0]!;
}

/** Stale or foreign ids (restored state, links) fall back to the default page. */
export function resolveSettingsPageId(
  kind: SettingsScopeKind,
  pageId: string | undefined,
): string {
  return pageId && Object.hasOwn(pagesByScope[kind], pageId)
    ? pageId
    : defaultSettingsPageId(kind);
}

/** The page's detail declaration; undefined for pages without drill-in. */
export function settingsPageDetail(
  kind: SettingsScopeKind,
  pageId: string | undefined,
): { param: string } | undefined {
  return pageId && Object.hasOwn(pagesByScope[kind], pageId)
    ? pagesByScope[kind][pageId]!.detail
    : undefined;
}

/** A deep link: a page, optionally one of its detail items and a section. */
export type SettingsTarget = {
  pageId?: string;
  item?: string;
  section?: string;
};

export type SettingsRedirect = {
  from: { pageId: string; section?: string };
  to: { pageId: string; item?: string; section?: string };
};

/** Turned off only by tests that exercise targets without redirects. */
export const SETTINGS_REDIRECTS_ENABLED = true;

/**
 * The scope a deep link resolves in. The settings surface shows user and
 * project pages together, so user pages (Devices, Notifications…) stay user
 * pages while a project is open; only the rest resolve in the project.
 */
export function settingsScopeForPage(
  projectOpen: boolean,
  pageId: string | undefined,
): SettingsScopeKind {
  if (!projectOpen) return "user";
  return pageId && Object.hasOwn(pagesByScope.user, pageId)
    ? "user"
    : "project";
}

/** Old page/section targets and where they live now. */
export const settingsRedirects: readonly SettingsRedirect[] = [
  { from: { pageId: "integrations" }, to: { pageId: "extensions" } },
];

/**
 * Normalizes a deep link for a scope: applies redirects (section-specific
 * entries win over page-wide ones), and drops `item` for pages without a
 * detail. A redirect whose destination page is not in the scope is ignored.
 */
export function resolveSettingsTarget(
  kind: SettingsScopeKind,
  target: SettingsTarget,
  options: {
    redirects?: readonly SettingsRedirect[];
    enabled?: boolean;
  } = {},
): SettingsTarget {
  const {
    redirects = settingsRedirects,
    enabled = SETTINGS_REDIRECTS_ENABLED,
  } = options;
  let next = target;
  const { pageId } = target;
  if (enabled && pageId) {
    const match =
      redirects.find(
        (r) =>
          r.from.pageId === pageId &&
          r.from.section !== undefined &&
          r.from.section === target.section,
      ) ?? redirects.find((r) => r.from.pageId === pageId && !r.from.section);
    if (match && Object.hasOwn(pagesByScope[kind], match.to.pageId)) {
      next = {
        pageId: match.to.pageId,
        ...(match.to.item ? { item: match.to.item } : {}),
        ...((match.to.section ?? target.section)
          ? { section: match.to.section ?? target.section }
          : {}),
      };
    }
  }
  const resolvedPage = next.pageId
    ? resolveSettingsPageId(kind, next.pageId)
    : undefined;
  const hasDetail = settingsPageDetail(kind, resolvedPage) !== undefined;
  return {
    ...(next.pageId ? { pageId: resolvedPage } : {}),
    ...(next.item && hasDetail ? { item: next.item } : {}),
    ...(next.section ? { section: next.section } : {}),
  };
}
