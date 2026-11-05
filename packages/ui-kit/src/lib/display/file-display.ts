export type FileDisplayMode = "raw" | "rendered";
export type FileRenderKind = "markdown" | "mermaid" | "html" | "svg";

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdown", ".mkd"]);
const MERMAID_EXTENSIONS = new Set([".mmd", ".mermaid"]);
const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const SVG_EXTENSIONS = new Set([".svg"]);

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
  if (HTML_EXTENSIONS.has(extension)) return "html";
  if (SVG_EXTENSIONS.has(extension)) return "svg";
  return undefined;
}

export function isMarkdownPath(path: string | undefined): boolean {
  return fileRenderKind(path) === "markdown";
}

export function isMermaidPath(path: string | undefined): boolean {
  return fileRenderKind(path) === "mermaid";
}

/**
 * Whether rendering `text` would show nothing: blank text, or Markdown that
 * is only front matter and comments, or Mermaid that is only `%%` comments.
 */
export function isRenderedContentEmpty(
  kind: FileRenderKind,
  text: string,
): boolean {
  let body = text;
  if (kind === "markdown") {
    body = body
      .replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/, "")
      .replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  } else if (kind === "mermaid") {
    body = body.replace(/^\s*%%.*$/gm, "");
  }
  return body.trim() === "";
}

/**
 * Markdown, Mermaid and SVG open rendered, unless their content is known and
 * would render empty; then the source opens so the file can be written.
 */
export function defaultFileDisplayMode(
  path: string | undefined,
  text?: string,
): FileDisplayMode {
  const kind = fileRenderKind(path);
  if (kind !== "markdown" && kind !== "mermaid" && kind !== "svg") return "raw";
  if (text !== undefined && isRenderedContentEmpty(kind, text)) return "raw";
  return "rendered";
}
