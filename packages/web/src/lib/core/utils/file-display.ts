export type FileDisplayMode = "raw" | "rendered";

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdown", ".mkd"]);

export function isMarkdownPath(path: string | undefined): boolean {
  if (!path) return false;
  const cleanPath = path.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  const dotIndex = cleanPath.lastIndexOf(".");
  if (dotIndex === -1) return false;
  return MARKDOWN_EXTENSIONS.has(cleanPath.slice(dotIndex));
}

export function defaultFileDisplayMode(
  path: string | undefined,
): FileDisplayMode {
  return isMarkdownPath(path) ? "rendered" : "raw";
}
