import type { FilePaneContent } from "../../../presentation/files/file-pane-contracts.js";

export function htmlPreviewAvailability(
  file?: FilePaneContent,
): string | undefined {
  if (!file || file.type !== "text")
    return "HTML preview is unavailable until the file is loaded.";
  if (file.truncated)
    return "HTML preview is unavailable for truncated content. Open a complete, small project file.";
  const path = file.relativePath;
  if (
    !path ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[A-Za-z]:/.test(path) ||
    path.split(/[\\/]/).includes("..")
  ) {
    return "HTML preview is available only for files inside the project.";
  }
  return undefined;
}
