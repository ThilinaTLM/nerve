export type FilesPanelPreferences = {
  /** Hide entries matched by ignore rules instead of dimming them. */
  hideIgnored: boolean;
  /** Show entries whose name starts with a dot. `.git` follows this too. */
  showDotfiles: boolean;
  /** Reveal the active editor file in the tree whenever it changes. */
  autoReveal: boolean;
};

export type FilesPanelPreferenceStorage = Pick<Storage, "getItem" | "setItem">;

const STORAGE_KEY = "nerve:files-panel-preferences:v1";
const defaultPreferences: FilesPanelPreferences = {
  hideIgnored: false,
  showDotfiles: true,
  autoReveal: true,
};

export function browserFilesPanelPreferenceStorage():
  | FilesPanelPreferenceStorage
  | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function booleanField(
  source: object,
  key: keyof FilesPanelPreferences,
): boolean {
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : defaultPreferences[key];
}

export function loadFilesPanelPreferences(
  storage:
    | FilesPanelPreferenceStorage
    | undefined = browserFilesPanelPreferenceStorage(),
): FilesPanelPreferences {
  if (!storage) return { ...defaultPreferences };
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return { ...defaultPreferences };
    return {
      hideIgnored: booleanField(parsed, "hideIgnored"),
      showDotfiles: booleanField(parsed, "showDotfiles"),
      autoReveal: booleanField(parsed, "autoReveal"),
    };
  } catch {
    return { ...defaultPreferences };
  }
}

export function persistFilesPanelPreferences(
  preferences: FilesPanelPreferences,
  storage:
    | FilesPanelPreferenceStorage
    | undefined = browserFilesPanelPreferenceStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // The in-memory preference still applies when storage is unavailable.
  }
}
