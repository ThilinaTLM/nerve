import { discoverNewsCatalog } from "./content/news.js";
import type { DiscoverAutoOpenState } from "./policy.js";

export const DISCOVER_STORAGE_KEY = "nerve.discover.state";

export type DiscoverSeenVersions = Record<string, number>;

export type DiscoverProgress = {
  seen: DiscoverSeenVersions;
  autoOpen: DiscoverAutoOpenState;
};

type DiscoverStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

type StoredDiscoverProgress = {
  schemaVersion: 1;
} & DiscoverProgress;

const entryIds = new Set<string>(discoverNewsCatalog.map((entry) => entry.id));

export const defaultDiscoverProgress: DiscoverProgress = {
  seen: {},
  autoOpen: { enabled: true, count: 0 },
};

function browserStorage(): DiscoverStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function validVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function parseSeenVersions(value: unknown): DiscoverSeenVersions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const versions: DiscoverSeenVersions = {};
  for (const [id, version] of Object.entries(value)) {
    if (entryIds.has(id) && validVersion(version)) versions[id] = version;
  }
  return versions;
}

function parseAutoOpen(value: unknown): DiscoverAutoOpenState {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { ...defaultDiscoverProgress.autoOpen };
  const candidate = value as Partial<DiscoverAutoOpenState>;
  return {
    enabled: candidate.enabled !== false,
    version:
      typeof candidate.version === "string" && candidate.version.length > 0
        ? candidate.version
        : undefined,
    count: validVersion(candidate.count) ? candidate.count : 0,
  };
}

/**
 * Returns undefined when nothing has ever been stored, which is what marks a
 * first run for the auto-open policy.
 */
export function readDiscoverProgress(
  storage: DiscoverStorage | undefined = browserStorage(),
): DiscoverProgress | undefined {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(DISCOVER_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredDiscoverProgress>;
    if (parsed.schemaVersion !== 1) return undefined;
    return {
      seen: parseSeenVersions(parsed.seen),
      autoOpen: parseAutoOpen(parsed.autoOpen),
    };
  } catch {
    return undefined;
  }
}

export function writeDiscoverProgress(
  progress: DiscoverProgress,
  storage: DiscoverStorage | undefined = browserStorage(),
): void {
  if (!storage) return;
  try {
    const payload: StoredDiscoverProgress = {
      schemaVersion: 1,
      seen: parseSeenVersions(progress.seen),
      autoOpen: parseAutoOpen(progress.autoOpen),
    };
    storage.setItem(DISCOVER_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Persistence is best effort; reactive state still covers this session.
  }
}

/** Marks every news entry read at its current content version. */
export function markAllSeen(seen: DiscoverSeenVersions): DiscoverSeenVersions {
  let next = seen;
  for (const entry of discoverNewsCatalog) {
    if ((next[entry.id] ?? 0) >= entry.version) continue;
    if (next === seen) next = { ...seen };
    next[entry.id] = entry.version;
  }
  return next;
}
