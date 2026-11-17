export type FileViewerPreferences = {
  highlightSelectionMatches: boolean;
  wrapLongLines: boolean;
  diffLayout: "unified" | "split";
  /**
   * The last view picked per file extension (`.csv`): an extension preview's key
   * (`<extension-id>/<preview-id>`) or `default` for Nerve's own view.
   */
  extensionPreviews: Record<string, string>;
};

/** Most remembered file extensions; the oldest choice drops first. */
export const maxExtensionPreviewChoices = 64;

/** Records one choice, moving it to the newest position and capping the map. */
export function withExtensionPreviewChoice(
  choices: Record<string, string>,
  fileExtension: string,
  choice: string,
): Record<string, string> {
  const next = { ...choices };
  delete next[fileExtension];
  next[fileExtension] = choice;
  const keys = Object.keys(next);
  for (const key of keys.slice(
    0,
    Math.max(0, keys.length - maxExtensionPreviewChoices),
  ))
    delete next[key];
  return next;
}

function parseExtensionPreviews(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === "string" && entry[0].length <= 40,
  );
  return Object.fromEntries(entries.slice(-maxExtensionPreviewChoices));
}

export type FileViewerPreferenceStorage = Pick<Storage, "getItem" | "setItem">;

const STORAGE_KEY = "nerve:file-viewer-preferences:v1";
const defaultPreferences: FileViewerPreferences = {
  highlightSelectionMatches: false,
  wrapLongLines: false,
  diffLayout: "unified",
  extensionPreviews: {},
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
  if (!storage) return { ...defaultPreferences, extensionPreviews: {} };
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object")
      return { ...defaultPreferences, extensionPreviews: {} };
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
      diffLayout:
        "diffLayout" in parsed && parsed.diffLayout === "split"
          ? "split"
          : "unified",
      extensionPreviews: parseExtensionPreviews(
        "extensionPreviews" in parsed ? parsed.extensionPreviews : undefined,
      ),
    };
  } catch {
    return { ...defaultPreferences, extensionPreviews: {} };
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
