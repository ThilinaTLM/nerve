import type { GitPanelFilter } from "../views/git-repo-tree";

/** Per project: what the repository list shows. */
export interface GitProjectPreferences {
  filter: GitPanelFilter;
  /** Expanded repository groups; null until the user (or first load) decides. */
  expanded: string[] | null;
  /** Relative path of the selected worktree. */
  selected: string | null;
}

/**
 * Panel-wide: the same in every project. Areas fit their content unless the
 * user dragged a height (share 0..1 of the panel); null = automatic.
 */
export interface GitPanelLayoutPreferences {
  listSize: number | null;
  branch: { collapsed: boolean; size: number | null };
  changes: { collapsed: boolean };
}

export type GitPanelPreferenceStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;

const PROJECT_PREFIX = "nerve:git-panel:v1:";
const LAYOUT_KEY = "nerve:git-panel-layout:v3";
/** Project entries kept before the least recently written are dropped. */
export const MAX_PROJECT_ENTRIES = 50;
const MIN_SHARE = 0.05;
const MAX_SHARE = 0.9;

export const defaultGitProjectPreferences = (): GitProjectPreferences => ({
  filter: "all",
  expanded: null,
  selected: null,
});

export const defaultGitPanelLayout = (): GitPanelLayoutPreferences => ({
  listSize: null,
  branch: { collapsed: false, size: null },
  changes: { collapsed: true },
});

export function browserGitPanelPreferenceStorage():
  | GitPanelPreferenceStorage
  | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function readJson(
  storage: GitPanelPreferenceStorage,
  key: string,
): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? "null");
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter((item) => typeof item === "string"))];
}

export function loadGitProjectPreferences(
  projectId: string,
  storage:
    | GitPanelPreferenceStorage
    | undefined = browserGitPanelPreferenceStorage(),
): GitProjectPreferences {
  const defaults = defaultGitProjectPreferences();
  const stored = storage && readJson(storage, PROJECT_PREFIX + projectId);
  if (!stored) return defaults;
  const filter = stored.filter;
  return {
    filter:
      filter === "changed" || filter === "attention" || filter === "all"
        ? filter
        : defaults.filter,
    expanded: stringList(stored.expanded),
    selected: typeof stored.selected === "string" ? stored.selected : null,
  };
}

function usedAt(storage: GitPanelPreferenceStorage, key: string): number {
  const value = readJson(storage, key)?.usedAt;
  return typeof value === "number" ? value : 0;
}

/** Drops the least recently written project entries beyond the cap. */
export function capGitProjectEntries(
  storage: GitPanelPreferenceStorage,
  max = MAX_PROJECT_ENTRIES,
): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(PROJECT_PREFIX)) keys.push(key);
  }
  if (keys.length <= max) return;
  keys
    .map((key) => ({ key, at: usedAt(storage, key) }))
    .sort((a, b) => a.at - b.at)
    .slice(0, keys.length - max)
    .forEach(({ key }) => storage.removeItem(key));
}

export function persistGitProjectPreferences(
  projectId: string,
  preferences: GitProjectPreferences,
  storage:
    | GitPanelPreferenceStorage
    | undefined = browserGitPanelPreferenceStorage(),
  now = Date.now(),
): void {
  if (!storage) return;
  try {
    storage.setItem(
      PROJECT_PREFIX + projectId,
      JSON.stringify({ ...preferences, usedAt: now }),
    );
    capGitProjectEntries(storage);
  } catch {
    // The in-memory preference still applies when storage is unavailable.
  }
}

/** Forgets repositories and worktrees that discovery no longer returns. */
export function pruneGitProjectPreferences(
  preferences: GitProjectPreferences,
  known: { groups: ReadonlySet<string>; worktrees: ReadonlySet<string> },
): GitProjectPreferences {
  return {
    ...preferences,
    expanded: preferences.expanded
      ? preferences.expanded.filter((key) => known.groups.has(key))
      : null,
    selected:
      preferences.selected && known.worktrees.has(preferences.selected)
        ? preferences.selected
        : null,
  };
}

const collapsedOf = (value: unknown, fallback: boolean): boolean =>
  isRecord(value) && typeof value.collapsed === "boolean"
    ? value.collapsed
    : fallback;

function shareOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(MAX_SHARE, Math.max(MIN_SHARE, value))
    : null;
}

export function loadGitPanelLayout(
  storage:
    | GitPanelPreferenceStorage
    | undefined = browserGitPanelPreferenceStorage(),
): GitPanelLayoutPreferences {
  const defaults = defaultGitPanelLayout();
  const stored = storage && readJson(storage, LAYOUT_KEY);
  if (!stored) return defaults;
  const branch = stored.branch;
  return {
    listSize: shareOf(stored.listSize),
    branch: {
      collapsed: collapsedOf(branch, defaults.branch.collapsed),
      size: shareOf(isRecord(branch) ? branch.size : undefined),
    },
    changes: {
      collapsed: collapsedOf(stored.changes, defaults.changes.collapsed),
    },
  };
}

export function persistGitPanelLayout(
  layout: GitPanelLayoutPreferences,
  storage:
    | GitPanelPreferenceStorage
    | undefined = browserGitPanelPreferenceStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // The in-memory layout still applies when storage is unavailable.
  }
}
