import { fallbackText } from "./fallback.js";
import { record } from "./candidate-values.js";

export function semanticSummary(
  value: unknown,
  index: number,
  excluded: string[] = [],
): string {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return `${index}. ${String(value)}`;
  const safe = pickSemantic(
    record(value),
    [
      "title",
      "name",
      "key",
      "id",
      "status",
      "state",
      "type",
      "url",
      "path",
      "email",
      "displayName",
      "snippet",
      "content",
      "summary",
      "todo",
      "done",
      "line",
      "text",
    ].filter((key) => !excluded.includes(key)),
  );
  return `${index}. ${Object.keys(safe).length > 0 ? formatFlat(safe).replaceAll("\n", " · ") : fallbackText(value)}`;
}

export function semanticObjectText(value: unknown, depth: number): string {
  if (depth > 3) return "";
  if (Array.isArray(value))
    return value
      .slice(0, 3)
      .map((item, index) => semanticSummary(item, index + 1))
      .join("\n");
  if (!value || typeof value !== "object") return String(value ?? "");
  const ignored =
    /^(raw|rawResult|contentBlocks|body|description|submitted|payload|request|input|adf|storage)$/i;
  const lines: string[] = [];
  for (const [key, nested] of Object.entries(record(value))) {
    if (ignored.test(key) || nested === undefined || nested === null) continue;
    if (Array.isArray(nested)) {
      lines.push(`${key}: ${nested.length}`);
      const preview = nested
        .slice(0, 3)
        .map((item, index) => semanticSummary(item, index + 1))
        .join("\n");
      if (preview) lines.push(preview);
    } else if (typeof nested === "object") {
      const child = semanticObjectText(nested, depth + 1);
      if (child) lines.push(`${key}:\n${child}`);
    } else if (typeof nested === "string" && nested.length > 2_000) {
      lines.push(`${key}: ${nested.slice(0, 2_000)}…`);
    } else lines.push(`${key}: ${String(nested)}`);
  }
  return lines.join("\n");
}

export function pickSemantic(
  value: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of keys)
    if (value[key] !== undefined && value[key] !== null)
      output[key] = value[key];
  return output;
}

export function formatFlat(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(
      ([key, nested]) =>
        `${key}: ${Array.isArray(nested) ? nested.map(String).join(", ") : String(nested)}`,
    )
    .join("\n");
}
