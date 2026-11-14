import type { ExtensionDisplayKind } from "@nervekit/contracts/extensions";

/*
 * What the display kinds of an extension's direct tool expect of the result
 * value (`details.display.value`). Readers are tolerant: a value that does not
 * fit the kind yields nothing and the card falls back to the result text.
 */

export type DisplayLink = { title: string; url: string; snippet?: string };
export type DisplayTable = { columns: string[]; rows: string[][] };

const MAX_COLUMNS = 8;
const MAX_CELL_CHARS = 200;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** `links`: `{ title, url, snippet? }[]` (a few common aliases are accepted). */
export function displayLinks(value: unknown): DisplayLink[] {
  const items = Array.isArray(value)
    ? value
    : value === undefined
      ? []
      : [value];
  return items.flatMap((item): DisplayLink[] => {
    const entry = record(item);
    const url = text(entry?.url) ?? text(entry?.href);
    if (!entry || !url) return [];
    const snippet =
      text(entry.snippet) ??
      text(entry.content) ??
      text(entry.description) ??
      text(entry.summary);
    return [
      {
        title:
          text(entry.title) ?? text(entry.name) ?? text(entry.label) ?? url,
        url,
        ...(snippet ? { snippet } : {}),
      },
    ];
  });
}

function cell(value: unknown): string {
  const shown =
    value === undefined || value === null
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  return shown.length > MAX_CELL_CHARS
    ? `${shown.slice(0, MAX_CELL_CHARS - 1)}…`
    : shown;
}

/** `table`: rows of records, or `{ columns, rows }` with array rows. */
export function displayTable(value: unknown): DisplayTable | undefined {
  const shaped = record(value);
  if (shaped && Array.isArray(shaped.columns) && Array.isArray(shaped.rows)) {
    const columns = shaped.columns.slice(0, MAX_COLUMNS).map(cell);
    return {
      columns,
      rows: shaped.rows.map((row) =>
        columns.map((_, index) => cell(Array.isArray(row) ? row[index] : "")),
      ),
    };
  }
  if (!Array.isArray(value)) return undefined;
  const rows = value.flatMap((row) => {
    const entry = record(row);
    return entry ? [entry] : [];
  });
  if (rows.length === 0) return undefined;
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(
    0,
    MAX_COLUMNS,
  );
  return {
    columns,
    rows: rows.map((row) => columns.map((column) => cell(row[column]))),
  };
}

/** `artifact`: a handle, `{ handle }` or a list of either. */
export function displayArtifactHandles(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [value];
  return items.flatMap((item) => {
    const handle = text(item) ?? text(record(item)?.handle);
    return handle ? [handle] : [];
  });
}

/** How many items the card lists, with the noun for its footer. */
export function displayItemCount(display: {
  kind: ExtensionDisplayKind;
  value?: unknown;
}): { count: number; noun: string } | undefined {
  switch (display.kind) {
    case "links":
      return { count: displayLinks(display.value).length, noun: "result" };
    case "table":
      return {
        count: displayTable(display.value)?.rows.length ?? 0,
        noun: "row",
      };
    default:
      return undefined;
  }
}
