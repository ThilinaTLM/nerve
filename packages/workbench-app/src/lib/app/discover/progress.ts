import {
  discoverEditorialCatalog,
  type DiscoverEditorialId,
} from "./catalog.js";

export const DISCOVER_SEEN_STORAGE_KEY = "nerve.discover.seen";

export type DiscoverSeenVersions = Partial<Record<DiscoverEditorialId, number>>;

type DiscoverStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

type StoredDiscoverProgress = {
  schemaVersion: 1;
  seen: DiscoverSeenVersions;
};

const editorialIds = new Set<string>(
  discoverEditorialCatalog.map((item) => item.id),
);

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
    if (editorialIds.has(id) && validVersion(version)) {
      versions[id as DiscoverEditorialId] = version;
    }
  }
  return versions;
}

export function readDiscoverSeenVersions(
  storage: DiscoverStorage | undefined = browserStorage(),
): DiscoverSeenVersions {
  if (!storage) return {};
  try {
    const raw = storage.getItem(DISCOVER_SEEN_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<StoredDiscoverProgress>;
    if (parsed.schemaVersion !== 1) return {};
    return parseSeenVersions(parsed.seen);
  } catch {
    return {};
  }
}

export function writeDiscoverSeenVersions(
  seen: DiscoverSeenVersions,
  storage: DiscoverStorage | undefined = browserStorage(),
): void {
  if (!storage) return;
  try {
    const payload: StoredDiscoverProgress = {
      schemaVersion: 1,
      seen: parseSeenVersions(seen),
    };
    storage.setItem(DISCOVER_SEEN_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Persistence is best effort; reactive state still covers this session.
  }
}

export function markEditorialSeen(
  seen: DiscoverSeenVersions,
): DiscoverSeenVersions {
  let next = seen;
  for (const item of discoverEditorialCatalog) {
    if ((next[item.id] ?? 0) >= item.version) continue;
    if (next === seen) next = { ...seen };
    next[item.id] = item.version;
  }
  return next;
}
