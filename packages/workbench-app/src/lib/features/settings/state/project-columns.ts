/** Pages that are User-only until the header switch adds the project's column. */
export const PROJECT_COLUMN_PAGES = ["general", "tools"] as const;
export type ProjectColumnPage = (typeof PROJECT_COLUMN_PAGES)[number];

/** Whether each page shows the project's column. Remembered per page, not per project. */
export type ProjectColumnPreferences = Record<ProjectColumnPage, boolean>;

export type ProjectColumnStorage = Pick<Storage, "getItem" | "setItem">;

const STORAGE_KEY = "nerve:settings-project-columns:v1";

export const defaultProjectColumnPreferences: ProjectColumnPreferences = {
  general: false,
  tools: false,
};

function browserStorage(): ProjectColumnStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Validates field by field; missing or corrupt values stay off. */
export function parseProjectColumnPreferences(
  value: unknown,
): ProjectColumnPreferences {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    general: source.general === true,
    tools: source.tools === true,
  };
}

export function loadProjectColumnPreferences(
  storage: ProjectColumnStorage | undefined = browserStorage(),
): ProjectColumnPreferences {
  if (!storage) return { ...defaultProjectColumnPreferences };
  try {
    return parseProjectColumnPreferences(
      JSON.parse(storage.getItem(STORAGE_KEY) ?? "null"),
    );
  } catch {
    return { ...defaultProjectColumnPreferences };
  }
}

export function persistProjectColumnPreferences(
  preferences: ProjectColumnPreferences,
  storage: ProjectColumnStorage | undefined = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // The in-memory preference still applies when storage is unavailable.
  }
}
