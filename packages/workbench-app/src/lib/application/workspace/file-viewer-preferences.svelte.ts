import {
  loadFileViewerPreferences,
  persistFileViewerPreferences,
} from "./file-viewer-preferences.js";

export const fileViewerPreferences = $state(loadFileViewerPreferences());

export function setWrapLongLines(enabled: boolean): void {
  fileViewerPreferences.wrapLongLines = enabled;
  persistFileViewerPreferences(fileViewerPreferences);
}

export function setHighlightSelectionMatches(enabled: boolean): void {
  fileViewerPreferences.highlightSelectionMatches = enabled;
  persistFileViewerPreferences(fileViewerPreferences);
}
