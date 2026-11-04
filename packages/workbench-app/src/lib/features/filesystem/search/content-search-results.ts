import type {
  FilesystemProjectContentFileResult,
  FilesystemProjectContentMatch,
} from "@nervekit/contracts/filesystem";

export type SearchResultItem =
  | {
      type: "file";
      key: string;
      parentKey?: undefined;
      path: string;
      count: number;
    }
  | {
      type: "match";
      key: string;
      parentKey: string;
      path: string;
      line: number;
      text: string;
      ranges: Array<[number, number]>;
    };

const PREVIEW_LEAD = 12;

/** Trims indentation and, when the first hit sits far into a long line, the
 * lead-in, so the highlighted text is visible in a narrow panel. */
export function previewMatch(match: FilesystemProjectContentMatch): {
  text: string;
  ranges: Array<[number, number]>;
} {
  const indent = match.text.length - match.text.trimStart().length;
  let cut = indent;
  const first = Math.min(...match.ranges.map(([start]) => start));
  let prefix = "";
  if (Number.isFinite(first) && first - cut > PREVIEW_LEAD) {
    cut = first - PREVIEW_LEAD;
    prefix = "…";
  }
  return {
    text: prefix + match.text.slice(cut),
    ranges: match.ranges
      .map(
        ([start, end]) =>
          [start - cut + prefix.length, end - cut + prefix.length] as [
            number,
            number,
          ],
      )
      .filter(([, end]) => end > 0),
  };
}

export function fileResultKey(path: string): string {
  return `file:${path}`;
}

/** Flattens grouped results into parent-keyed tree items. */
export function buildSearchResultItems(
  files: readonly FilesystemProjectContentFileResult[],
): SearchResultItem[] {
  const items: SearchResultItem[] = [];
  for (const file of files) {
    const key = fileResultKey(file.path);
    items.push({
      type: "file",
      key,
      path: file.path,
      count: file.matches.length,
    });
    file.matches.forEach((match, index) => {
      const preview = previewMatch(match);
      items.push({
        type: "match",
        key: `match:${file.path}:${match.line}:${index}`,
        parentKey: key,
        path: file.path,
        line: match.line,
        text: preview.text,
        ranges: preview.ranges,
      });
    });
  }
  return items;
}

export function countMatches(
  files: readonly FilesystemProjectContentFileResult[],
): number {
  return files.reduce((total, file) => total + file.matches.length, 0);
}

/** Comma/newline separated glob list from an input field. */
export function parseGlobList(value: string): string[] | undefined {
  const globs = value
    .split(/[,\n]/)
    .map((glob) => glob.trim())
    .filter(Boolean);
  return globs.length > 0 ? globs : undefined;
}
