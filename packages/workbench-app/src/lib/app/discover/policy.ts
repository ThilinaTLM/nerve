import type { ResolvedGuide } from "./guides/catalog-policy.js";
import type { DiscoverNewsEntry, DiscoverTipEntry } from "./content/entries.js";
import type { DiscoverSeenVersions } from "./progress.js";

export const PENDING_DISCOVER_RELEASE = "next";

export type ResolvedNewsEntry = DiscoverNewsEntry & { unread: boolean };

/** Minor release lines that stay out of the archive. */
export const DISCOVER_RELEASE_WINDOW = 2;

/** News for one `major.minor` release line such as `0.38`. */
export type DiscoverReleaseGroup = {
  release: string;
  label: string;
  featured?: ResolvedNewsEntry;
  entries: ResolvedNewsEntry[];
};

export type DiscoverNewsSection = {
  spotlight?: ResolvedNewsEntry;
  releases: DiscoverReleaseGroup[];
  archive: ResolvedNewsEntry[];
  unreadCount: number;
};

export type DiscoverSetupSection = {
  /** Must-do setup is unfinished, so getting started outranks the news. */
  leading: boolean;
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
 * News is grouped by minor release line, newest first. The latest
 * `DISCOVER_RELEASE_WINDOW` lines stay prominent so highlights outlive a patch
 * or two; older lines drop into the archive. Pending entries join the newest
 * line, and its featured entry (pending first) becomes the spotlight.
 */
export function buildDiscoverSections(input: {
  guides: readonly ResolvedGuide[];
  news: readonly ResolvedNewsEntry[];
  tips: readonly DiscoverTipEntry[];
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

  return {
    news: buildNewsSection(input.news),
    setup: {
      leading: pending.some((guide) => guide.priority === "must-do"),
      pending,
      completed,
      completedCount: completed.length,
      totalCount: setupGuides.length,
    },
    walkthroughs: available.filter((guide) => guide.category !== "setup"),
    tips: input.tips,
  };
}

function buildNewsSection(
  news: readonly ResolvedNewsEntry[],
): DiscoverNewsSection {
  const released = news.filter(
    (entry) => entry.releasedIn !== PENDING_DISCOVER_RELEASE,
  );
  const lines = [
    ...new Set(released.map((entry) => releaseLine(entry.releasedIn))),
  ]
    .sort(compareReleaseLines)
    .slice(0, DISCOVER_RELEASE_WINDOW);
  // Pending entries are stamped with the real version at release time, so
  // they read as part of the newest line rather than a separate section.
  const newest = lines[0] ?? PENDING_DISCOVER_RELEASE;
  const lineOf = (entry: ResolvedNewsEntry) =>
    entry.releasedIn === PENDING_DISCOVER_RELEASE
      ? newest
      : releaseLine(entry.releasedIn);
  const prominent = new Set([newest, ...lines]);

  let spotlight: ResolvedNewsEntry | undefined;
  const releases = [...prominent].map((line): DiscoverReleaseGroup => {
    const entries = news
      .filter((entry) => lineOf(entry) === line)
      .sort(
        (left, right) =>
          Number(right.releasedIn === PENDING_DISCOVER_RELEASE) -
          Number(left.releasedIn === PENDING_DISCOVER_RELEASE),
      );
    if (line === newest) {
      spotlight = entries.find((entry) => entry.featured);
    }
    // The spotlight's line shows everything else as plain cards.
    const featured =
      line === newest && spotlight
        ? undefined
        : entries.find((entry) => entry.featured);
    return {
      release: line,
      label: releaseGroupLabel(line),
      featured,
      entries: entries.filter(
        (entry) => entry !== spotlight && entry !== featured,
      ),
    };
  });

  return {
    spotlight,
    releases: releases.filter(
      (group) => group.featured || group.entries.length > 0,
    ),
    archive: news.filter((entry) => !prominent.has(lineOf(entry))),
    unreadCount: unreadNewsCount(news),
  };
}

/** `0.38.1` -> `0.38`; the pending release keeps its own line. */
export function releaseLine(releasedIn: string): string {
  if (releasedIn === PENDING_DISCOVER_RELEASE) return releasedIn;
  return normalizeVersion(releasedIn).split(".").slice(0, 2).join(".");
}

function compareReleaseLines(left: string, right: string): number {
  const [lMajor = 0, lMinor = 0] = left.split(".").map(Number);
  const [rMajor = 0, rMinor = 0] = right.split(".").map(Number);
  return rMajor - lMajor || rMinor - lMinor;
}

export function unreadNewsCount(news: readonly ResolvedNewsEntry[]): number {
  return news.filter((entry) => entry.unread).length;
}

/**
 * Only news shipped in the running version may trigger release auto-open;
 * pending announcements are previewable but never pull Discover open.
 */
export function unreadNewsForVersion(
  news: readonly ResolvedNewsEntry[],
  appVersion: string | undefined,
): number {
  if (!appVersion) return 0;
  const version = normalizeVersion(appVersion);
  return news.filter((entry) => entry.unread && entry.releasedIn === version)
    .length;
}

export function discoverReleaseLabel(releasedIn: string): string {
  return releasedIn === PENDING_DISCOVER_RELEASE ? "Next release" : releasedIn;
}

/** Heading for a release line group. */
export function releaseGroupLabel(line: string): string {
  return line === PENDING_DISCOVER_RELEASE ? "New" : `New in ${line}`;
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
