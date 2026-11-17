import {
  withExtensionPreviewChoice,
  loadFileViewerPreferences,
  persistFileViewerPreferences,
} from "./file-viewer-preferences.js";

export const fileViewerPreferences = $state(loadFileViewerPreferences());

export function setWrapLongLines(enabled: boolean): void {
  fileViewerPreferences.wrapLongLines = enabled;
  persistFileViewerPreferences(fileViewerPreferences);
}

export function setDiffLayout(layout: "unified" | "split"): void {
  fileViewerPreferences.diffLayout = layout;
  persistFileViewerPreferences(fileViewerPreferences);
}

export function setHighlightSelectionMatches(enabled: boolean): void {
  fileViewerPreferences.highlightSelectionMatches = enabled;
  persistFileViewerPreferences(fileViewerPreferences);
}

export function setExtensionPreviewChoice(
  fileExtension: string,
  choice: string,
): void {
  fileViewerPreferences.extensionPreviews = withExtensionPreviewChoice(
    fileViewerPreferences.extensionPreviews,
    fileExtension,
    choice,
  );
  persistFileViewerPreferences(fileViewerPreferences);
}
