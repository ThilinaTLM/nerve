const EXTENSIONS: Record<string, string> = {
  "text/html": ".html",
  "text/plain": ".txt",
  "text/xml": ".xml",
  "text/css": ".css",
  "text/csv": ".csv",
  "application/json": ".json",
  "application/xml": ".xml",
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
};

export function baseContentType(contentType: string): string {
  return contentType.split(";")[0]?.trim().toLowerCase() || "";
}

/** File extension for saving a response of this media type. */
export function extensionFor(contentType: string): string {
  return EXTENSIONS[baseContentType(contentType)] ?? ".bin";
}

export function isTextType(contentType: string): boolean {
  const base = baseContentType(contentType);
  return (
    base.startsWith("text/") ||
    base === "application/json" ||
    base === "application/xml" ||
    base === "application/javascript"
  );
}

export function isHtml(contentType: string): boolean {
  return baseContentType(contentType) === "text/html";
}

const TITLE_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

export function htmlTitle(html: string): string | undefined {
  const raw = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  // One pass, so `&amp;lt;` decodes to `&lt;`, not `<`.
  const title = raw
    ?.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => TITLE_ENTITIES[entity])
    .replace(/\s+/g, " ")
    .trim();
  return title || undefined;
}

const SNIPPET_MAX_CHARS = 300;

/** Bound the per-result snippet so structured results stay small. */
export function snippet(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return undefined;
  return normalized.length <= SNIPPET_MAX_CHARS
    ? normalized
    : `${normalized.slice(0, SNIPPET_MAX_CHARS - 1)}…`;
}
