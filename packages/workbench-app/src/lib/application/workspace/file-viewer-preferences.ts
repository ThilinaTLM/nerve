export type FileViewerPreferences = {
  highlightSelectionMatches: boolean;
  wrapLongLines: boolean;
};

export type FileViewerPreferenceStorage = Pick<Storage, "getItem" | "setItem">;

const STORAGE_KEY = "nerve:file-viewer-preferences:v1";
const defaultPreferences: FileViewerPreferences = {
  highlightSelectionMatches: false,
  wrapLongLines: false,
};

export function browserFileViewerPreferenceStorage():
  | FileViewerPreferenceStorage
  | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function loadFileViewerPreferences(
  storage:
    | FileViewerPreferenceStorage
    | undefined = browserFileViewerPreferenceStorage(),
): FileViewerPreferences {
  if (!storage) return { ...defaultPreferences };
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return { ...defaultPreferences };
    return {
      highlightSelectionMatches:
        "highlightSelectionMatches" in parsed &&
        typeof parsed.highlightSelectionMatches === "boolean"
          ? parsed.highlightSelectionMatches
          : false,
      wrapLongLines:
        "wrapLongLines" in parsed && typeof parsed.wrapLongLines === "boolean"
          ? parsed.wrapLongLines
          : false,
    };
  } catch {
    return { ...defaultPreferences };
  }
}

export function persistFileViewerPreferences(
  preferences: FileViewerPreferences,
  storage:
    | FileViewerPreferenceStorage
    | undefined = browserFileViewerPreferenceStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // The in-memory preference still applies when storage is unavailable.
  }
}
