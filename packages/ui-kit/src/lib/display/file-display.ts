export type FileDisplayMode = "raw" | "rendered";
export type FileRenderKind = "markdown" | "mermaid";

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdown", ".mkd"]);
const MERMAID_EXTENSIONS = new Set([".mmd", ".mermaid"]);

export function fileRenderKind(
  path: string | undefined,
): FileRenderKind | undefined {
  if (!path) return undefined;
  const cleanPath = path.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  const dotIndex = cleanPath.lastIndexOf(".");
  if (dotIndex === -1) return undefined;
  const extension = cleanPath.slice(dotIndex);
  if (MARKDOWN_EXTENSIONS.has(extension)) return "markdown";
  if (MERMAID_EXTENSIONS.has(extension)) return "mermaid";
  return undefined;
}

export function isMarkdownPath(path: string | undefined): boolean {
  return fileRenderKind(path) === "markdown";
}

export function isMermaidPath(path: string | undefined): boolean {
  return fileRenderKind(path) === "mermaid";
}

export function defaultFileDisplayMode(
  path: string | undefined,
): FileDisplayMode {
  return fileRenderKind(path) ? "rendered" : "raw";
}
