import {
  defaultGitPrFilterConfig,
  normalizeGitPrFilterConfig,
  type GitPrFilterConfig,
  type GitPrQuickFilter,
} from "../pr-filters";

/** Remembered per project: the quick filter and the filter menu. */
export type PrPanelPreferences = {
  readonly quick: GitPrQuickFilter;
  readonly filters: GitPrFilterConfig;
};

export type PrPanelPreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export const defaultPrPanelPreferences: PrPanelPreferences = {
  quick: "all",
  filters: defaultGitPrFilterConfig,
};

export function prPanelPreferencesKey(projectId: string): string {
  return `nerve:git-pr-panel:v1:${projectId}`;
}

function browserStorage(): PrPanelPreferenceStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Validates stored data field by field; missing or corrupt values use defaults. */
export function parsePrPanelPreferences(value: unknown): PrPanelPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return defaultPrPanelPreferences;
  const source = value as Record<string, unknown>;
  const filters =
    source.filters && typeof source.filters === "object"
      ? (source.filters as Record<string, unknown>)
      : {};
  return {
    quick: oneOf(source.quick, ["all", "mine", "review"], "all"),
    filters: normalizeGitPrFilterConfig({
      drafts: oneOf(
        filters.drafts,
        ["include", "exclude", "only"],
        defaultGitPrFilterConfig.drafts,
      ),
      labels: Array.isArray(filters.labels)
        ? filters.labels.filter(
            (label): label is string => typeof label === "string",
          )
        : [],
      sort: oneOf(
        filters.sort,
        ["updated-desc", "updated-asc"],
        defaultGitPrFilterConfig.sort,
      ),
    }),
  };
}

export function loadPrPanelPreferences(
  projectId: string,
  storage: PrPanelPreferenceStorage | undefined = browserStorage(),
): PrPanelPreferences {
  if (!storage) return defaultPrPanelPreferences;
  try {
    return parsePrPanelPreferences(
      JSON.parse(storage.getItem(prPanelPreferencesKey(projectId)) ?? "null"),
    );
  } catch {
    return defaultPrPanelPreferences;
  }
}

export function persistPrPanelPreferences(
  projectId: string,
  preferences: PrPanelPreferences,
  storage: PrPanelPreferenceStorage | undefined = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(
      prPanelPreferencesKey(projectId),
      JSON.stringify(parsePrPanelPreferences(preferences)),
    );
  } catch {
    // Storage is best effort; in-memory preferences still apply.
  }
}
