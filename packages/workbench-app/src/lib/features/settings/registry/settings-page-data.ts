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
};

const providers: PageData = {
  label: "Providers",
  sections: [
    { id: "subscriptions", label: "Subscriptions" },
    { id: "api-keys", label: "API keys" },
    { id: "custom-providers", label: "Custom providers" },
    { id: "custom-models", label: "Custom models" },
  ],
};
const integrations: PageData = {
  label: "Integrations",
  description:
    "Accounts the agent's tools sign in with. Add several and choose one per tool.",
  sections: [
    { id: "tavily-accounts", label: "Tavily" },
    { id: "atlassian-accounts", label: "Atlassian" },
  ],
};
const general: PageData = {
  label: "General",
  description:
    "Defaults for new conversations. Projects and conversations can override them.",
  sections: [
    { id: "new-conversations", label: "New conversations" },
    { id: "model", label: "Model" },
    { id: "compaction", label: "Compaction" },
  ],
};
const tools: PageData = {
  label: "Tools",
  sections: [{ id: "tools", label: "Tools" }],
};
const skills: PageData = {
  label: "Skills",
  description:
    "Skills apply from the next agent turn. Project definitions take precedence over your skills with the same name.",
  sections: [{ id: "skills", label: "Skills" }],
};
const agents: PageData = {
  label: "Agents",
  description:
    "Main agent profiles that apply settings, instructions and locks to a conversation. Later edits don't change conversations that already applied one.",
  sections: [{ id: "agents", label: "Agents" }],
};
const subAgents: PageData = {
  label: "Sub-Agents",
  description:
    "Profiles the lead agent can delegate work to. Later edits don't change sub-agents that already started.",
  sections: [{ id: "sub-agents", label: "Sub-Agents" }],
};
const permissionRules: PageData = {
  label: "Permission rules",
  description:
    "Rule sets decide which tool calls are allowed, asked about or blocked.",
  sections: [{ id: "rule-sets", label: "Rule sets" }],
};
const models: PageData = {
  label: "Models",
  description: "Limit which models the composer offers.",
  sections: [{ id: "models", label: "Models" }],
};
const suggestions: PageData = {
  label: "Suggestions",
  description:
    "Project suggestions override user and built-in suggestions with the same name.",
  sections: [{ id: "suggestions", label: "Suggestions" }],
};

const userPages: Record<string, PageData> = {
  providers,
  integrations,
  general,
  tools,
  skills,
  agents,
  "sub-agents": subAgents,
  "permission-rules": permissionRules,
  models,
  workbench: {
    label: "Workbench",
    sections: [
      { id: "appearance", label: "Appearance" },
      { id: "desktop", label: "Desktop" },
    ],
  },
  notifications: {
    label: "Notifications",
    sections: [
      { id: "general", label: "General" },
      { id: "sounds", label: "Sounds" },
    ],
  },
  shortcuts: {
    label: "Shortcuts",
    description:
      "Shortcuts are fixed and use the primary modifier for your platform.",
    sections: [{ id: "shortcuts", label: "Shortcuts" }],
  },
  voice: {
    label: "Voice",
    description:
      "Configure the OpenAI model and context hints used for voice input.",
    sections: [
      { id: "model", label: "Model" },
      { id: "context", label: "Context" },
    ],
  },
  suggestions,
  storage: {
    label: "Storage",
    description:
      "Understand what Nerve keeps locally and safely reclaim space.",
    sections: [{ id: "storage", label: "Storage" }],
  },
  system: {
    label: "System",
    sections: [
      { id: "network", label: "Network" },
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
      "Overrides for this project. Anything left unset follows your user settings.",
  },
  tools,
  skills,
  agents: {
    ...agents,
    description:
      "Agent profiles stored in this project. They are shared with everyone who opens the repo.",
  },
  "sub-agents": {
    ...subAgents,
    description:
      "Sub-agent profiles stored in this project. They are shared with everyone who opens the repo.",
  },
  "permission-rules": permissionRules,
  launch: {
    label: "Launch",
    description: "Launch definitions for this project.",
    sections: [{ id: "launch", label: "Launch" }],
  },
  "instructions-files": {
    label: "Instructions files",
    description:
      "AGENTS.md files and .nerve/APPEND_SYSTEM.md that join the system prompt.",
    sections: [
      { id: "agents-md", label: "AGENTS.md" },
      { id: "append-system", label: "Append system" },
    ],
  },
  suggestions,
  trust: {
    label: "Trust",
    description: "Project files Nerve only reads after you review them.",
    sections: [
      { id: "trust", label: "Trust" },
      { id: "profile-files", label: "Profile files" },
      { id: "suggestion-scripts", label: "Suggestion scripts" },
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
    pages: ["providers", "integrations"],
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
    pages: ["workbench", "notifications", "shortcuts", "voice"],
  },
  { id: "system", title: "System", pages: ["storage", "system"] },
];

const projectLayout: NavLayout = [
  { id: "agent", title: "Agent", pages: ["general", "tools", "skills"] },
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
