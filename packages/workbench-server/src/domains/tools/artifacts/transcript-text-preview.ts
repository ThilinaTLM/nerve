/** Shared head/tail text truncation and overflow accounting for transcript previews. */
/** Default head/tail line and item count of transcript previews. */
export const PREVIEW_COUNT = 6;
/** Shared public text budget of one transcript preview. */
export const MAX_PREVIEW_CHARS = 8 * 1024;

export type Preview<T> = {
  value: T;
  hidden: number;
  hiddenLines?: number;
  hiddenChars?: number;
};

export function firstLines(
  text: string | undefined,
  count = PREVIEW_COUNT,
  maxChars = MAX_PREVIEW_CHARS,
): Preview<string | undefined> {
  if (text === undefined) return emptyTextPreview(undefined);
  const lineEnd = endAfterFirstLines(text, count);
  const charEnd = Math.min(lineEnd, maxChars);
  const value = text.slice(0, charEnd);
  const hiddenLines = countLinesFrom(text, lineEnd);
  const hiddenChars = Math.max(0, text.length - charEnd);
  return {
    value,
    hidden: visibleHiddenCount(hiddenLines, hiddenChars),
    hiddenLines,
    hiddenChars,
  };
}

export function lastLines(
  text: string | undefined,
  count = PREVIEW_COUNT,
): Preview<string | undefined> {
  if (text === undefined) return emptyTextPreview(undefined);
  const logicalEnd = text.endsWith("\n") ? text.length - 1 : text.length;
  const lineStart = startBeforeLastLines(text, logicalEnd, count);
  const charStart = Math.max(lineStart, logicalEnd - MAX_PREVIEW_CHARS);
  const value = text.slice(charStart, logicalEnd);
  const hiddenLines = countLinesUntil(text, lineStart);
  const hiddenChars = Math.max(0, charStart);
  return {
    value,
    hidden: visibleHiddenCount(hiddenLines, hiddenChars),
    hiddenLines,
    hiddenChars,
  };
}

function emptyTextPreview<T extends string | undefined>(value: T): Preview<T> {
  return { value, hidden: 0, hiddenLines: 0, hiddenChars: 0 };
}

export function visibleHiddenCount(
  hiddenLines: number,
  hiddenChars: number,
): number {
  return hiddenLines > 0 ? hiddenLines : hiddenChars;
}

function endAfterFirstLines(text: string, count: number): number {
  if (count <= 0) return 0;
  let lines = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "\n") continue;
    if (lines >= count) return index;
    lines += 1;
  }
  return text.length;
}

function startBeforeLastLines(
  text: string,
  logicalEnd: number,
  count: number,
): number {
  if (count <= 0) return logicalEnd;
  let remaining = count;
  for (let index = logicalEnd - 1; index >= 0; index -= 1) {
    if (text[index] !== "\n") continue;
    remaining -= 1;
    if (remaining === 0) return index + 1;
  }
  return 0;
}

function countLinesFrom(text: string, offset: number): number {
  if (offset >= text.length) return 0;
  let start = offset;
  if (text[start] === "\n") start += 1;
  if (start >= text.length) return 0;
  let lines = 1;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === "\n") lines += 1;
  }
  return lines;
}

function countLinesUntil(text: string, offset: number): number {
  if (offset <= 0) return 0;
  const end = Math.min(offset - 1, text.length);
  if (end <= 0) return 0;
  let lines = 1;
  for (let index = 0; index < end; index += 1) {
    if (text[index] === "\n") lines += 1;
  }
  return lines;
}

export function textOverflowStats(previews: Array<Preview<unknown>>): {
  hidden: number;
  noun: string;
} {
  const hiddenLines = previews.reduce(
    (total, preview) => total + (preview.hiddenLines ?? 0),
    0,
  );
  const hiddenChars = previews.reduce(
    (total, preview) => total + (preview.hiddenChars ?? 0),
    0,
  );
  if (hiddenLines > 0) return { hidden: hiddenLines, noun: "lines" };
  return { hidden: hiddenChars, noun: "characters" };
}
