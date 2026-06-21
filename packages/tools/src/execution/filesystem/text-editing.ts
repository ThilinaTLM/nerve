import { formatPatch, OMIT_HEADERS, structuredPatch } from "diff";

export type LineEnding = "\n" | "\r\n";

export function detectLineEnding(input: string): LineEnding {
  const crlf = input.match(/\r\n/g)?.length ?? 0;
  const lf = input.match(/(?<!\r)\n/g)?.length ?? 0;
  return crlf > lf ? "\r\n" : "\n";
}

export function normalizeLineEndings(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function restoreLineEndings(
  input: string,
  lineEnding: LineEnding,
): string {
  return lineEnding === "\n" ? input : input.replace(/\n/g, "\r\n");
}

export function firstChangedLine(
  before: string,
  after: string,
): number | undefined {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const length = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < length; index += 1) {
    if (beforeLines[index] !== afterLines[index]) return index + 1;
  }
  return undefined;
}

export function generateDiffString(before: string, after: string): string {
  const patch = structuredPatch("", "", before, after, undefined, undefined, {
    context: 3,
  });
  const diff = formatPatch(patch, OMIT_HEADERS);
  return diff.endsWith("\n") ? diff.slice(0, -1) : diff;
}

export function normalizeSmartPunctuation(input: string): string {
  return input
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-");
}

export function normalizeForTrimmedMatch(input: string): string {
  return normalizeSmartPunctuation(normalizeLineEndings(input))
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}
