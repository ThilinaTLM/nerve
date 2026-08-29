const DEFAULT_LIMIT = 300;

export function atlassianPlainTextPreview(
  value: unknown,
  limit = DEFAULT_LIMIT,
): string | undefined {
  const text = plainText(value);
  const normalized = decodeEntities(text).replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, limit - 1)}…`;
}

function plainText(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        return plainText(JSON.parse(trimmed));
      } catch {
        // Treat malformed JSON-shaped content as ordinary text.
      }
    }
    return value
      .replace(/<ac:parameter\b[^>]*>.*?<\/ac:parameter>/gis, " ")
      .replace(/<[^>]+>/g, " ");
  }
  if (Array.isArray(value)) return value.map(plainText).join(" ");
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const pieces: string[] = [];
  if (record.type === "text" && typeof record.text === "string") {
    pieces.push(record.text);
  }
  if (typeof record.value === "string") pieces.push(plainText(record.value));
  if (record.content !== undefined) pieces.push(plainText(record.content));
  if (record.body !== undefined) pieces.push(plainText(record.body));
  if (record.storage !== undefined) pieces.push(plainText(record.storage));
  if (record.atlas_doc_format !== undefined) {
    pieces.push(plainText(record.atlas_doc_format));
  }
  return pieces.join(" ");
}

function decodeEntities(value: string): string {
  return value
    .replaceAll(/&nbsp;/gi, " ")
    .replaceAll(/&lt;/gi, "<")
    .replaceAll(/&gt;/gi, ">")
    .replaceAll(/&quot;/gi, '"')
    .replaceAll(/&#39;|&apos;/gi, "'")
    .replaceAll(/&amp;/gi, "&");
}
