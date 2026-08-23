import { guideCatalog, type GuideId } from "./catalog.js";

export const GUIDE_COMPLETION_STORAGE_KEY = "nerve.guides.completion";
export const LEGACY_PRODUCT_TOUR_STORAGE_KEY =
  "nerve.product-tour.completed-version";

export type GuideCompletionVersions = Partial<Record<GuideId, number>>;

type GuideStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

type StoredGuideCompletion = {
  schemaVersion: 1;
  guides: GuideCompletionVersions;
};

const guideIds = new Set<string>(guideCatalog.map((guide) => guide.id));

function browserStorage(): GuideStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function validVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function parseVersions(value: unknown): GuideCompletionVersions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const versions: GuideCompletionVersions = {};
  for (const [id, version] of Object.entries(value)) {
    if (guideIds.has(id) && validVersion(version)) {
      versions[id as GuideId] = version;
    }
  }
  return versions;
}

export function readGuideCompletionVersions(
  storage: GuideStorage | undefined = browserStorage(),
): GuideCompletionVersions {
  if (!storage) return {};
  try {
    const raw = storage.getItem(GUIDE_COMPLETION_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredGuideCompletion>;
      if (parsed.schemaVersion !== 1) return {};
      return parseVersions(parsed.guides);
    }

    const legacy = storage.getItem(LEGACY_PRODUCT_TOUR_STORAGE_KEY);
    if (!legacy || !/^(0|[1-9]\d*)$/.test(legacy)) return {};
    const version = Number(legacy);
    return Number.isSafeInteger(version) ? { workbench: version } : {};
  } catch {
    return {};
  }
}

export function writeGuideCompletionVersions(
  guides: GuideCompletionVersions,
  storage: GuideStorage | undefined = browserStorage(),
): void {
  if (!storage) return;
  try {
    const payload: StoredGuideCompletion = {
      schemaVersion: 1,
      guides: parseVersions(guides),
    };
    storage.setItem(GUIDE_COMPLETION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Persistence is best effort; reactive state still covers this session.
  }
}

export function completeGuideVersion(
  versions: GuideCompletionVersions,
  id: GuideId,
  version: number,
): GuideCompletionVersions {
  if (!validVersion(version) || (versions[id] ?? 0) >= version) return versions;
  return { ...versions, [id]: version };
}
