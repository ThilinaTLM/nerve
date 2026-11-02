/**
 * Mock models for the Shell section. Every fixture is typed with the real
 * production types so svelte-check proves the shapes the real titlebar,
 * status bar and Discover views receive.
 */
import type { LatestRelease, StatusResponse } from "@nervekit/contracts/status";
import { discoverNewsCatalog } from "$lib/app/discover/content/news";
import { discoverTipsCatalog } from "$lib/app/discover/content/tips";
import { buildDiscoverSections, resolveNews } from "$lib/app/discover/policy";
import type { DiscoverPageModel } from "$lib/app/discover/state.svelte";
import type { ResolvedGuide } from "$lib/app/discover/guides/catalog-policy";
import type { ProjectSwitcherItem } from "$lib/features/projects/state/project-switcher";
import type { SubscriptionUsageEntry } from "$lib/features/usage/usage-types";
import type { NotificationItem } from "$lib/presentation/activity/notifications";
import {
  idleConversationActivity,
  type ConversationActivity,
} from "$lib/presentation/conversations/conversation-activity";

const stamp = "2026-10-14T09:00:00.000Z";

export const labHomeDir = "/home/user";
export const labVersion = "0.37.0";
export const labLatestRelease: LatestRelease = {
  version: labVersion,
  releaseUrl: "https://github.com/nervekit/nerve/releases/tag/v0.37.0",
  publishedAt: stamp,
};

/* ------------------------------- Projects ------------------------------- */

const runningActivity: ConversationActivity = {
  ...idleConversationActivity,
  indicator: "running",
  tone: "info",
  pulse: true,
  busy: true,
  label: "Agent running",
};

/** Background work (sub-agents, async commands); also labelled "Running". */
const awaitingAsyncActivity: ConversationActivity = {
  ...idleConversationActivity,
  indicator: "awaiting-async",
  tone: "info",
  label: "Waiting for subagents or background commands",
};

const needsUserActivity: ConversationActivity = {
  ...idleConversationActivity,
  indicator: "needs-user",
  tone: "warning",
  needsUser: true,
  label: "Needs your attention",
  statusText: "Approval needed",
};

function projectItem(
  id: string,
  name: string,
  conversationCount: number,
  activity: ConversationActivity = idleConversationActivity,
): ProjectSwitcherItem {
  const dir = `${labHomeDir}/Projects/${name}`;
  return {
    key: dir,
    project: {
      id,
      name,
      directory: dir,
      dir,
      createdAt: stamp,
      updatedAt: stamp,
    },
    projectIds: [id],
    label: name,
    sortAt: stamp,
    conversationCount,
    activity,
  };
}

/**
 * Titlebar quick projects: one active, one with a running agent, one waiting
 * on background work (both read "Running" in the switcher).
 */
export const labProjects: ProjectSwitcherItem[] = [
  projectItem("proj_nerve", "nerve", 36),
  projectItem("proj_atlas", "atlas-api", 12),
  projectItem("proj_web", "web-app", 21, runningActivity),
  projectItem("proj_notes", "design-notes", 4, awaitingAsyncActivity),
];

/** Switcher popover lists every project, including ones not in the bar. */
export const labProjectOptions: ProjectSwitcherItem[] = [
  ...labProjects,
  projectItem("proj_infra", "infra", 9, needsUserActivity),
];

export const labActiveProject = labProjects[0];

/* --------------------------- Status bar models --------------------------- */

export const labStatus: StatusResponse = {
  daemonId: "daemon_lab",
  version: labVersion,
  startedAt: stamp,
  dataDir: `${labHomeDir}/.nerve`,
  storage: {
    home: `${labHomeDir}/.nerve`,
    userHome: labHomeDir,
    sqlitePath: `${labHomeDir}/.nerve/nerve.sqlite`,
    indexHealthy: true,
  },
  capabilities: { applicationLogs: true },
  runtime: {
    python: { available: true, source: "path", version: "3.12.4" },
    editors: {
      vscode: { available: true, source: "path" },
      zed: { available: false },
    },
    terminal: { available: true, source: "system" },
  },
  resourceContainment: {
    backend: "cgroup_v2",
    hardLimitsAvailable: true,
    enforcement: "best_effort",
  },
};

export const labGitStatus = {
  branch: "design-system/foundations",
  dirty: true,
  changeCount: 28,
  ahead: 2,
  behind: null,
  detached: false,
  hasUpstream: true,
  relativePath: ".",
  repoName: "nerve",
  repoCount: 1,
};

export const labUsages: SubscriptionUsageEntry[] = [
  {
    provider: "anthropic",
    active: true,
    usage: {
      provider: "anthropic",
      session: {
        usedPercent: 31,
        resetsAt: null,
        resetAfterSeconds: 85 * 60,
        windowMinutes: 300,
      },
      weekly: {
        usedPercent: 10,
        resetsAt: null,
        resetAfterSeconds: 5 * 24 * 3600,
        windowMinutes: 10080,
      },
      planType: "max",
      updatedAt: stamp,
    },
  },
  {
    provider: "openai-codex",
    active: false,
    usage: {
      provider: "openai-codex",
      session: null,
      weekly: {
        usedPercent: 22,
        resetsAt: null,
        resetAfterSeconds: 5 * 24 * 3600 + 15 * 3600,
        windowMinutes: 10080,
      },
      planType: "prolite",
      updatedAt: stamp,
    },
  },
];

/* ------------------------------- Activity ------------------------------- */

export const labNotifications: NotificationItem[] = [
  {
    id: "act_approval",
    kind: "attention",
    title: "Approval needed",
    context: "infra · Rotate staging credentials",
    at: stamp,
    children: [],
    unread: true,
    conversationId: "conv_infra",
  },
  {
    id: "act_running",
    kind: "running",
    title: "Agent running",
    context: "web-app · Fix flaky reconnect test",
    at: stamp,
    children: [
      { id: "sub_1", title: "Reproduce the failure", status: "done" },
      { id: "sub_2", title: "Patch the retry loop", status: "running" },
    ],
    unread: false,
    conversationId: "conv_web",
  },
];

/* ------------------------------- Discover ------------------------------- */

function guide(
  definition: Omit<ResolvedGuide, "ready" | "available" | "lifecycle">,
): ResolvedGuide {
  return {
    ...definition,
    lifecycle: "available",
    ready: undefined,
    available: true,
  };
}

const pendingGuides: ResolvedGuide[] = [
  guide({
    id: "provider",
    version: 1,
    title: "Connect a model provider",
    description:
      "Add an API key or sign in to a subscription so agents can run.",
    category: "setup",
    priority: "must-do",
    actionLabel: "Start guide",
    completed: false,
  }),
  guide({
    id: "scoped-models",
    version: 1,
    title: "Configure scoped models",
    description:
      "Choose which authenticated models appear in the composer so model selection stays focused.",
    category: "setup",
    priority: "highly-recommended",
    actionLabel: "Start guide",
    completed: false,
  }),
  guide({
    id: "web-search",
    version: 1,
    title: "Set up web search",
    description:
      "Add a Tavily API key to let agents use the web_search tool for current information.",
    category: "setup",
    priority: "optional",
    actionLabel: "Start guide",
    completed: false,
  }),
];

const completedGuides: ResolvedGuide[] = [
  guide({
    id: "open-project",
    version: 1,
    title: "Open a project",
    description: "Choose a project folder.",
    category: "setup",
    priority: "must-do",
    completed: true,
  }),
  guide({
    id: "voice",
    version: 1,
    title: "Set up voice input",
    description: "Dictate prompts.",
    category: "setup",
    priority: "optional",
    completed: true,
  }),
];

const walkthroughGuides: ResolvedGuide[] = [
  guide({
    id: "workbench",
    version: 1,
    title: "Work through the Workbench",
    description:
      "Tour conversations, capabilities, sub-agents, background commands and launch configs.",
    category: "walkthrough",
    priority: "optional",
    actionLabel: "Start tour",
    run: { kind: "workbench-tour" },
    completed: false,
  }),
];

/** Release the lab pretends to run, so the next-release news is current and 0.37.0 is archived. */
const labDiscoverVersion = "0.38.0";

/** The real news and tips catalogs, so the lab shows the shipped Discover content. */
const labDiscoverSections = buildDiscoverSections({
  guides: [...pendingGuides, ...completedGuides, ...walkthroughGuides],
  news: resolveNews(discoverNewsCatalog, {}),
  tips: discoverTipsCatalog,
  appVersion: labDiscoverVersion,
});

export const labDiscoverModel: DiscoverPageModel = {
  currentVersion: labDiscoverVersion,
  latestVersion: labDiscoverVersion,
  latestReleaseUrl: undefined,
  autoOpenEnabled: true,
  unreadCount: labDiscoverSections.news.unreadCount,
  sections: labDiscoverSections,
};
