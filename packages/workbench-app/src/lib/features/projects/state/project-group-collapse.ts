export type ProjectGroupCollapseState = Record<string, true>;

export const projectGroupCollapseStorageKey =
  "nerve.projectNavigator.collapsedGroups.v1";

function getLocalStorage(): Storage | undefined {
  if (typeof localStorage === "undefined") return undefined;
  return localStorage;
}

export function sanitizeProjectGroupCollapseState(
  value: unknown,
): ProjectGroupCollapseState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const state: ProjectGroupCollapseState = {};
  for (const [key, collapsed] of Object.entries(value)) {
    if (key.trim().length > 0 && collapsed === true) state[key] = true;
  }
  return state;
}

export function loadProjectGroupCollapseState(): ProjectGroupCollapseState {
  const storage = getLocalStorage();
  if (!storage) return {};

  try {
    const raw = storage.getItem(projectGroupCollapseStorageKey);
    if (!raw) return {};
    return sanitizeProjectGroupCollapseState(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveProjectGroupCollapseState(
  state: ProjectGroupCollapseState,
): void {
  const storage = getLocalStorage();
  if (!storage) return;

  const sanitized = sanitizeProjectGroupCollapseState(state);
  try {
    if (Object.keys(sanitized).length === 0) {
      storage.removeItem(projectGroupCollapseStorageKey);
      return;
    }
    storage.setItem(projectGroupCollapseStorageKey, JSON.stringify(sanitized));
  } catch {
    // Persistence is best-effort; ignore storage failures such as quota errors.
  }
}
