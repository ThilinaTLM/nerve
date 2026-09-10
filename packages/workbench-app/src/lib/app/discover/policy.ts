import type { ResolvedGuide } from "./guides/catalog-policy.js";
import type { DiscoverNewsEntry, DiscoverTipEntry } from "./content/entries.js";
import type { DiscoverSeenVersions } from "./progress.js";

export type ResolvedNewsEntry = DiscoverNewsEntry & { unread: boolean };

export type DiscoverNewsSection = {
  featured?: ResolvedNewsEntry;
  current: ResolvedNewsEntry[];
  archive: ResolvedNewsEntry[];
  unreadCount: number;
};

export type DiscoverSetupSection = {
  pending: ResolvedGuide[];
  completed: ResolvedGuide[];
  completedCount: number;
  totalCount: number;
};

export type DiscoverSections = {
  news: DiscoverNewsSection;
  setup: DiscoverSetupSection;
  walkthroughs: ResolvedGuide[];
  tips: readonly DiscoverTipEntry[];
};

export type DiscoverBadge =
  | { kind: "none" }
  | { kind: "dot" }
  | { kind: "count"; value: number };

const priorityRank = {
  "must-do": 0,
  "highly-recommended": 1,
  optional: 2,
} as const;

export function resolveNews(
  entries: readonly DiscoverNewsEntry[],
  seen: DiscoverSeenVersions,
): ResolvedNewsEntry[] {
  return entries.map((entry) => ({
    ...entry,
    unread: (seen[entry.id] ?? 0) < entry.version,
  }));
}

/**
 * News for the running version stays in the main list; anything tagged with a
 * different release drops into the archive so the page keeps one release in
 * focus. Without a known app version every entry is treated as current.
 */
export function buildDiscoverSections(input: {
  guides: readonly ResolvedGuide[];
  news: readonly ResolvedNewsEntry[];
  tips: readonly DiscoverTipEntry[];
  appVersion: string | undefined;
}): DiscoverSections {
  const available = input.guides.filter((guide) => guide.available);
  const setupGuides = available.filter((guide) => guide.category === "setup");
  const pending = setupGuides
    .filter((guide) => !guide.completed)
    .sort(
      (left, right) =>
        priorityRank[left.priority] - priorityRank[right.priority],
    );
  const completed = setupGuides.filter((guide) => guide.completed);

  const isCurrent = (entry: ResolvedNewsEntry) =>
    !input.appVersion ||
    entry.releasedIn === normalizeVersion(input.appVersion);
  const current = input.news.filter(isCurrent);
  const archive = input.news.filter((entry) => !isCurrent(entry));
  const featured = current.find((entry) => entry.featured);

  return {
    news: {
      featured,
      current: current.filter((entry) => entry.id !== featured?.id),
      archive,
      unreadCount: input.news.filter((entry) => entry.unread).length,
    },
    setup: {
      pending,
      completed,
      completedCount: completed.length,
      totalCount: setupGuides.length,
    },
    walkthroughs: available.filter((guide) => guide.category !== "setup"),
    tips: input.tips,
  };
}

export function unreadNewsCount(news: readonly ResolvedNewsEntry[]): number {
  return news.filter((entry) => entry.unread).length;
}

/**
 * Unread news is the only thing worth a number; unfinished setup is a standing
 * invitation, so it shows as a dot that a user can leave alone forever.
 */
export function discoverBadge(input: {
  unreadNewsCount: number;
  pendingSetupCount: number;
}): DiscoverBadge {
  if (input.unreadNewsCount > 0)
    return { kind: "count", value: input.unreadNewsCount };
  return input.pendingSetupCount > 0 ? { kind: "dot" } : { kind: "none" };
}

export const DISCOVER_AUTO_OPEN_LIMIT = 2;

export type DiscoverAutoOpenReason = "first-run" | "release";

export type DiscoverAutoOpenDecision =
  | { open: false }
  | { open: true; reason: DiscoverAutoOpenReason };

export type DiscoverAutoOpenState = {
  enabled: boolean;
  version?: string;
  count: number;
};

const closed: DiscoverAutoOpenDecision = { open: false };

/**
 * Discover opens by itself only when it has something to say: once on a fresh
 * install, and up to `DISCOVER_AUTO_OPEN_LIMIT` times after an upgrade that
 * carries unread news. Reading the news, or turning the preference off, stops
 * it immediately.
 */
export function decideDiscoverAutoOpen(input: {
  ready: boolean;
  alreadyConsidered: boolean;
  firstRun: boolean;
  appVersion: string | undefined;
  unreadForCurrentVersion: number;
  autoOpen: DiscoverAutoOpenState;
}): DiscoverAutoOpenDecision {
  if (!input.ready || input.alreadyConsidered || !input.autoOpen.enabled)
    return closed;
  if (input.firstRun) return { open: true, reason: "first-run" };
  if (!input.appVersion || input.unreadForCurrentVersion === 0) return closed;

  const version = normalizeVersion(input.appVersion);
  const promptedCount =
    input.autoOpen.version === version ? input.autoOpen.count : 0;
  if (promptedCount >= DISCOVER_AUTO_OPEN_LIMIT) return closed;
  return { open: true, reason: "release" };
}

/** Counts one automatic open, restarting the budget when the version changes. */
export function countAutoOpen(
  state: DiscoverAutoOpenState,
  appVersion: string | undefined,
): DiscoverAutoOpenState {
  const version = appVersion ? normalizeVersion(appVersion) : undefined;
  const count = state.version === version ? state.count + 1 : 1;
  return { ...state, version, count };
}

/** Reading the page spends the remaining budget for the running version. */
export function exhaustAutoOpen(
  state: DiscoverAutoOpenState,
  appVersion: string | undefined,
): DiscoverAutoOpenState {
  const version = appVersion ? normalizeVersion(appVersion) : state.version;
  if (state.version === version && state.count >= DISCOVER_AUTO_OPEN_LIMIT)
    return state;
  return { ...state, version, count: DISCOVER_AUTO_OPEN_LIMIT };
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/, "");
}
