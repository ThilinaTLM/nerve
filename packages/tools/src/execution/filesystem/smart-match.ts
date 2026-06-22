import { ToolExecutionError } from "../common/tool-error.js";
import {
  normalizeForTrimmedMatch,
  normalizeSmartPunctuation,
} from "./text-editing.js";

export type MatchMode = "exact" | "trimmed" | "whitespace";

export type TextMatch = {
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  preview: string;
};

export type MatchResolution = {
  selected: TextMatch;
  matches: TextMatch[];
  matchedBy: "unique" | "occurrence";
};

type ClosestCandidate = {
  startLine: number;
  endLine: number;
  similarity: number;
  preview: string;
};
export function resolveTextMatch(options: {
  content: string;
  needle: string;
  matchMode: MatchMode;
  occurrence?: number;
  operationIndex: number;
  operationType: string;
  fieldName: string;
  fieldLabel?: string;
  path: string;
}): MatchResolution {
  const matches = findTextMatches(
    options.content,
    options.needle,
    options.matchMode,
  );
  if (matches.length === 0) {
    const candidates = closestCandidates(
      options.content,
      options.needle,
      options.matchMode,
    );
    throw new ToolExecutionError(
      "EDIT_MATCH_NOT_FOUND",
      missingMatchMessage(options, candidates),
      {
        operationIndex: options.operationIndex,
        operationType: options.operationType,
        fieldName: options.fieldName,
        path: options.path,
        matchMode: options.matchMode,
        candidates,
      },
      true,
    );
  }

  if (options.occurrence !== undefined) {
    const selected = matches[options.occurrence - 1];
    if (!selected) {
      throw new ToolExecutionError(
        "EDIT_OCCURRENCE_OUT_OF_RANGE",
        `${matchFieldLabel(options)} requested occurrence ${options.occurrence}, but ${matches.length} match(es) were found in ${options.path}.`,
        {
          operationIndex: options.operationIndex,
          operationType: options.operationType,
          path: options.path,
          matchMode: options.matchMode,
          occurrence: options.occurrence,
          matchCount: matches.length,
          matches: matches.slice(0, 5),
        },
        true,
      );
    }
    return { selected, matches, matchedBy: "occurrence" };
  }

  if (matches.length > 1) {
    throw new ToolExecutionError(
      "EDIT_MATCH_AMBIGUOUS",
      ambiguousMatchMessage(options, matches),
      {
        operationIndex: options.operationIndex,
        operationType: options.operationType,
        fieldName: options.fieldName,
        path: options.path,
        matchMode: options.matchMode,
        matchCount: matches.length,
        matches: matches.slice(0, 5),
      },
      true,
    );
  }

  const selected = matches[0];
  if (!selected) {
    throw new ToolExecutionError(
      "EDIT_MATCH_NOT_FOUND",
      `${matchFieldLabel(options)} was not found in ${options.path}.`,
      {
        operationIndex: options.operationIndex,
        operationType: options.operationType,
        fieldName: options.fieldName,
        path: options.path,
        matchMode: options.matchMode,
      },
      true,
    );
  }
  return { selected, matches, matchedBy: "unique" };
}

export function findTextMatches(
  content: string,
  needle: string,
  matchMode: MatchMode,
): TextMatch[] {
  switch (matchMode) {
    case "exact":
      return exactMatches(content, needle);
    case "trimmed":
      return trimmedMatches(content, needle);
    case "whitespace":
      return whitespaceMatches(content, needle);
  }
}

export function lineRangeForOffsets(
  content: string,
  start: number,
  end: number,
): { startLine: number; endLine: number; preview: string } {
  const starts = lineStarts(content);
  const startLine = offsetToLine(starts, Math.max(0, start));
  const endOffset = Math.max(start, end - 1);
  const endLine = offsetToLine(starts, endOffset);
  return {
    startLine,
    endLine,
    preview: previewLines(content, startLine, endLine),
  };
}

function exactMatches(content: string, needle: string): TextMatch[] {
  if (needle.length === 0) return [];
  const matches: TextMatch[] = [];
  let index = content.indexOf(needle);
  while (index >= 0) {
    matches.push(matchFromOffsets(content, index, index + needle.length));
    index = content.indexOf(needle, index + 1);
  }
  return matches;
}

function trimmedMatches(content: string, needle: string): TextMatch[] {
  const normalizedNeedle = normalizeForTrimmedMatch(needle);
  if (normalizedNeedle.length === 0) return [];
  const lines = content.split("\n");
  const needleLineCount = needle.split("\n").length;
  const offsets = lineOffsets(lines);
  const matches: TextMatch[] = [];
  const seen = new Set<string>();

  for (let line = 0; line < lines.length; line += 1) {
    for (
      let count = Math.max(1, needleLineCount - 1);
      count <= needleLineCount + 1;
      count += 1
    ) {
      const chunk = lines.slice(line, line + count).join("\n");
      if (normalizeForTrimmedMatch(chunk) !== normalizedNeedle) continue;
      const start = offsets[line] ?? 0;
      const end = start + chunk.length;
      const key = `${start}:${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push(matchFromOffsets(content, start, end));
    }
  }
  return matches;
}

function whitespaceMatches(content: string, needle: string): TextMatch[] {
  const normalizedContent = normalizeWhitespaceWithSpans(content);
  const normalizedNeedle = normalizeWhitespaceText(needle);
  if (normalizedNeedle.length === 0) return [];
  const matches: TextMatch[] = [];
  const seen = new Set<string>();
  let index = normalizedContent.text.indexOf(normalizedNeedle);
  while (index >= 0) {
    const firstSpan = normalizedContent.spans[index];
    const lastSpan =
      normalizedContent.spans[index + normalizedNeedle.length - 1];
    if (firstSpan && lastSpan) {
      const start = firstSpan.start;
      const end = lastSpan.end;
      const key = `${start}:${end}`;
      if (!seen.has(key)) {
        seen.add(key);
        matches.push(matchFromOffsets(content, start, end));
      }
    }
    index = normalizedContent.text.indexOf(normalizedNeedle, index + 1);
  }
  return matches;
}

function normalizeWhitespaceText(input: string): string {
  return normalizeWhitespaceWithSpans(input).text.trim();
}

function normalizeWhitespaceWithSpans(input: string): {
  text: string;
  spans: Array<{ start: number; end: number }>;
} {
  const chars: string[] = [];
  const spans: Array<{ start: number; end: number }> = [];
  let activeWhitespaceSpan: number | undefined;
  for (let index = 0; index < input.length; index += 1) {
    const raw = input[index] ?? "";
    const char = normalizeSmartPunctuation(raw);
    if (/\s/.test(char)) {
      if (activeWhitespaceSpan === undefined) {
        chars.push(" ");
        spans.push({ start: index, end: index + 1 });
        activeWhitespaceSpan = spans.length - 1;
      } else {
        const span = spans[activeWhitespaceSpan];
        if (span) span.end = index + 1;
      }
      continue;
    }
    activeWhitespaceSpan = undefined;
    chars.push(char);
    spans.push({ start: index, end: index + 1 });
  }
  return { text: chars.join(""), spans };
}

function lineOffsets(lines: string[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
}

function lineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n" && index + 1 < content.length) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function offsetToLine(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = starts[mid] ?? 0;
    const next = starts[mid + 1] ?? Number.POSITIVE_INFINITY;
    if (offset < start) high = mid - 1;
    else if (offset >= next) low = mid + 1;
    else return mid + 1;
  }
  return Math.max(1, starts.length);
}

function matchFromOffsets(
  content: string,
  start: number,
  end: number,
): TextMatch {
  const range = lineRangeForOffsets(content, start, end);
  return { start, end, ...range };
}

function previewLines(
  content: string,
  startLine: number,
  endLine: number,
): string {
  const lines = content.split("\n");
  const selected = lines.slice(startLine - 1, endLine).join("\n");
  return trimPreview(selected.replace(/\n/g, "\\n"));
}

function trimPreview(input: string, maxLength = 220): string {
  if (input.length <= maxLength) return input;
  return `${input.slice(0, maxLength - 1)}…`;
}

function matchFieldLabel(options: {
  operationIndex: number;
  operationType: string;
  fieldName: string;
  fieldLabel?: string;
}): string {
  return (
    options.fieldLabel ??
    `operations[${options.operationIndex}] ${options.operationType} ${options.fieldName}`
  );
}

function missingMatchMessage(
  options: {
    operationIndex: number;
    operationType: string;
    fieldName: string;
    fieldLabel?: string;
    path: string;
    matchMode: MatchMode;
  },
  candidates: ClosestCandidate[],
): string {
  const base = `${matchFieldLabel(options)} was not found in ${options.path} using matchMode "${options.matchMode}".`;
  if (candidates.length === 0) {
    return `${base} Try exact text from read output, matchMode "whitespace", or a line-range operation.`;
  }
  const formatted = candidates
    .map(
      (candidate, index) =>
        `${index + 1}. lines ${candidate.startLine}-${candidate.endLine}, similarity ${candidate.similarity.toFixed(2)}: ${candidate.preview}`,
    )
    .join("\n");
  return `${base}\nClosest candidates:\n${formatted}\nTry exact text from read output, matchMode "whitespace", or a line-range operation.`;
}

function ambiguousMatchMessage(
  options: {
    operationIndex: number;
    operationType: string;
    fieldName: string;
    fieldLabel?: string;
    path: string;
    matchMode: MatchMode;
  },
  matches: TextMatch[],
): string {
  const formatted = matches
    .slice(0, 5)
    .map(
      (match, index) =>
        `${index + 1}. lines ${match.startLine}-${match.endLine}: ${match.preview}`,
    )
    .join("\n");
  const suffix =
    matches.length > 5 ? `\n...${matches.length - 5} more match(es).` : "";
  return `${matchFieldLabel(options)} matched ${matches.length} times in ${options.path} using matchMode "${options.matchMode}"; provide a more specific ${options.fieldName} or set occurrence to 1..${matches.length}.\nMatches:\n${formatted}${suffix}`;
}

function closestCandidates(
  content: string,
  needle: string,
  matchMode: MatchMode,
): ClosestCandidate[] {
  const lines = content.split("\n");
  const needleLines = Math.max(1, needle.split("\n").length);
  const normalizedNeedle = normalizeForSimilarity(needle, matchMode);
  if (normalizedNeedle.length === 0) return [];
  const candidates: ClosestCandidate[] = [];
  const seen = new Set<string>();
  for (let line = 0; line < lines.length; line += 1) {
    for (
      let count = Math.max(1, needleLines - 1);
      count <= needleLines + 1;
      count += 1
    ) {
      const endLine = Math.min(lines.length, line + count);
      if (endLine <= line) continue;
      const chunk = lines.slice(line, endLine).join("\n");
      const normalizedChunk = normalizeForSimilarity(chunk, matchMode);
      const similarity = textSimilarity(normalizedNeedle, normalizedChunk);
      if (similarity <= 0) continue;
      const key = `${line + 1}:${endLine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        startLine: line + 1,
        endLine,
        similarity,
        preview: trimPreview(chunk.replace(/\n/g, "\\n")),
      });
    }
  }
  return candidates.sort((a, b) => b.similarity - a.similarity).slice(0, 3);
}

function normalizeForSimilarity(input: string, matchMode: MatchMode): string {
  if (matchMode === "exact") return input.trim().toLowerCase();
  if (matchMode === "trimmed")
    return normalizeForTrimmedMatch(input).toLowerCase();
  return normalizeWhitespaceText(input).toLowerCase();
}

function textSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const aTokens = tokenSet(a);
  const bTokens = tokenSet(b);
  if (aTokens.size > 0 && bTokens.size > 0) {
    let intersection = 0;
    for (const token of aTokens) {
      if (bTokens.has(token)) intersection += 1;
    }
    const dice = (2 * intersection) / (aTokens.size + bTokens.size);
    if (dice > 0) return dice;
  }
  const max = Math.max(a.length, b.length);
  if (max === 0) return 0;
  return commonPrefixLength(a, b) / max;
}

function tokenSet(input: string): Set<string> {
  return new Set(
    input
      .split(/\W+/u)
      .map((token) => token.trim())
      .filter((token) => token.length > 0),
  );
}

function commonPrefixLength(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  let count = 0;
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) break;
    count += 1;
  }
  return count;
}
