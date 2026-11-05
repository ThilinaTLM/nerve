import {
  rangesFromPositions,
  segmentsFromRanges,
  type HighlightSegment,
} from "../highlight-segments";

export type ParsedQuickOpenQuery = { query: string; line?: number };

/** Splits a trailing `:line` (or `:line:column`) from the typed query. */
export function parseQuickOpenQuery(raw: string): ParsedQuickOpenQuery {
  const trimmed = raw.trim();
  const match = /^(.*?):(\d+)(?::\d+)?$/.exec(trimmed);
  if (match) {
    const line = Number(match[2]);
    if (Number.isSafeInteger(line) && line > 0)
      return { query: (match[1] ?? "").trim(), line };
  }
  return { query: trimmed.replace(/:$/, "").trim() };
}

export type QuickOpenPathParts = {
  directory: string;
  name: string;
  directorySegments: HighlightSegment[];
  nameSegments: HighlightSegment[];
};

/** Splits a project path into dimmed directory and emphasized file name, with
 * the fuzzy-match positions applied to each part. */
export function quickOpenPathParts(
  path: string,
  positions: readonly number[] = [],
): QuickOpenPathParts {
  const slash = path.lastIndexOf("/");
  const directory = slash >= 0 ? path.slice(0, slash + 1) : "";
  const name = path.slice(slash + 1);
  return {
    directory,
    name,
    directorySegments: segmentsFromRanges(
      directory,
      rangesFromPositions(positions),
    ),
    nameSegments: segmentsFromRanges(
      name,
      rangesFromPositions(positions, directory.length),
    ),
  };
}

/** Recent files first (most recent first), without duplicates. */
export function recentQuickOpenPaths(
  openPaths: readonly string[],
  activePath?: string,
): string[] {
  const ordered = [...openPaths].reverse();
  const unique = [...new Set(ordered)];
  if (activePath && unique.includes(activePath))
    return [activePath, ...unique.filter((path) => path !== activePath)];
  return unique;
}
