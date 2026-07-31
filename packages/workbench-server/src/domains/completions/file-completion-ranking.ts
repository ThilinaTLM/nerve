import { isAbsolute } from "node:path";
import {
  FILE_COMPLETION_RESULT_LIMIT,
  type CompletionItem,
} from "@nervekit/contracts";
import type { FileCompletionCandidate } from "./file-completion-candidates.js";

export const defaultCompletionLimit = FILE_COMPLETION_RESULT_LIMIT;

export type CompletionOptions = {
  limit?: number;
};

export type CompletionItemInput = {
  candidate: FileCompletionCandidate;
  score: number;
  matchRanges: Array<[number, number]>;
};

type RankedCandidate = CompletionItemInput;

type TargetMatch = {
  score: number;
  ranges: Array<[number, number]>;
  segmentIndex: number;
};

type LocalMatch = {
  score: number;
  ranges: Array<[number, number]>;
};

export function completeFileCandidates(
  candidates: FileCompletionCandidate[],
  rawQuery: string,
  options: CompletionOptions = {},
): CompletionItem[] {
  const query = normalizeCompletionQuery(rawQuery);
  if (isUnsafeCompletionQuery(query)) return [];

  const ranked = candidates
    .map((candidate) => rankCandidate(candidate, query))
    .filter((candidate): candidate is RankedCandidate => Boolean(candidate))
    .sort(compareRankedCandidates);
  const limit = Math.min(
    options.limit ?? defaultCompletionLimit,
    FILE_COMPLETION_RESULT_LIMIT,
  );

  return ranked.slice(0, limit).map(toCompletionItem);
}

export function normalizeCompletionQuery(query: string): string {
  return query.trim().replace(/^@+/, "").replaceAll("\\", "/");
}

export function isUnsafeCompletionQuery(query: string): boolean {
  if (!query) return false;
  if (
    query.startsWith("/") ||
    query.startsWith("//") ||
    /^[A-Za-z]:\//.test(query) ||
    isAbsolute(query)
  ) {
    return true;
  }
  return query.split("/").some((segment) => segment === "..");
}

function rankCandidate(
  candidate: FileCompletionCandidate,
  query: string,
): RankedCandidate | undefined {
  const label = labelFor(candidate);
  if (!query) return rankEmptyCandidate(candidate);

  const queryLower = query.toLowerCase();
  const pathQuery = queryLower.replace(/\/+$/, "");
  const folderIntent = query.endsWith("/");

  if (folderIntent && candidate.pathLower === pathQuery) return undefined;

  if (candidate.pathLower === pathQuery) {
    return {
      candidate,
      score: 20_000 + kindBoost(candidate, folderIntent) - candidate.depth,
      matchRanges: [[1, Math.min(label.length, 1 + pathQuery.length)]],
    };
  }

  if (
    candidate.nameLower === queryLower ||
    candidate.stemLower === queryLower
  ) {
    const offset = labelNameOffset(candidate);
    const length =
      candidate.stemLower === queryLower
        ? candidate.stem.length
        : candidate.name.length;
    return {
      candidate,
      score: 18_000 + kindBoost(candidate, folderIntent) - candidate.depth,
      matchRanges: [[offset, offset + length]],
    };
  }

  if (candidate.pathLower.startsWith(queryLower)) {
    const remainder = candidate.pathLower
      .slice(queryLower.length)
      .replace(/^\/+/, "");
    const remainingDepth = remainder ? remainder.split("/").length : 0;
    return {
      candidate,
      score:
        16_000 +
        kindBoost(candidate, folderIntent) -
        remainingDepth * 120 -
        candidate.depth * 6 -
        candidate.relativePath.length / 20,
      matchRanges: [[1, Math.min(label.length, 1 + query.length)]],
    };
  }

  const terms = query
    .replace(/\/+$/, "")
    .split(query.includes("/") ? /\/+/ : /\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (terms.length === 0) return rankEmptyCandidate(candidate);
  if (terms.length > 6) return undefined;

  const matches = query.includes("/")
    ? orderedPathMatches(candidate, terms)
    : unorderedTermMatches(candidate, terms);
  if (!matches) return undefined;

  return {
    candidate,
    score:
      7_000 +
      matches.reduce((total, match) => total + match.score, 0) +
      kindBoost(candidate, folderIntent) -
      candidate.depth * 16 -
      candidate.relativePath.length / 8,
    matchRanges: mergeRanges(matches.flatMap((match) => match.ranges)),
  };
}

function rankEmptyCandidate(
  candidate: FileCompletionCandidate,
): RankedCandidate {
  const rootLevelBoost = candidate.depth === 1 ? 500 : 0;
  const kindScore = candidate.kind === "directory" ? 350 : 150;
  return {
    candidate,
    score:
      1_000 +
      rootLevelBoost +
      kindScore -
      candidate.depth * 40 -
      candidate.relativePath.length / 5,
    matchRanges: [],
  };
}

function compareRankedCandidates(
  a: RankedCandidate,
  b: RankedCandidate,
): number {
  return (
    b.score - a.score ||
    a.candidate.depth - b.candidate.depth ||
    a.candidate.relativePath.length - b.candidate.relativePath.length ||
    Number(b.candidate.kind === "directory") -
      Number(a.candidate.kind === "directory") ||
    a.candidate.relativePath.localeCompare(b.candidate.relativePath)
  );
}

export function toCompletionItem({
  candidate,
  score,
  matchRanges,
}: RankedCandidate): CompletionItem {
  const label = labelFor(candidate);
  const kindLabel = candidate.kind === "directory" ? "folder" : "file";
  const parent = candidate.parentPath || "project root";
  return {
    label,
    displayLabel: label,
    apply: label,
    detail: `${kindLabel} · ${parent}`,
    info: candidate.relativePath,
    kind: candidate.kind,
    sortScore: Math.round(score),
    matchRanges,
  };
}

function labelFor(candidate: FileCompletionCandidate): string {
  return `@${candidate.relativePath}${candidate.kind === "directory" ? "/" : ""}`;
}

export function labelNameOffset(candidate: FileCompletionCandidate): number {
  return 1 + candidate.relativePath.length - candidate.name.length;
}

function kindBoost(
  candidate: FileCompletionCandidate,
  folderIntent: boolean,
): number {
  if (folderIntent) return candidate.kind === "directory" ? 500 : -150;
  return candidate.kind === "file" ? 180 : 40;
}

function orderedPathMatches(
  candidate: FileCompletionCandidate,
  terms: string[],
): TargetMatch[] | undefined {
  const rows: Array<Array<TargetMatch | undefined>> = terms.map((term) =>
    candidate.segments.map((_, segmentIndex) =>
      matchSegment(candidate, term, segmentIndex),
    ),
  );
  const scores = rows.map(() =>
    candidate.segments.map(() => Number.NEGATIVE_INFINITY),
  );
  const previous = rows.map(() => candidate.segments.map(() => -1));

  for (let segment = 0; segment < candidate.segments.length; segment += 1) {
    const match = rows[0]?.[segment];
    if (match) scores[0]![segment] = match.score - segment * 35;
  }

  for (let term = 1; term < terms.length; term += 1) {
    let bestPreviousScore = Number.NEGATIVE_INFINITY;
    let bestPreviousIndex = -1;
    for (let segment = 0; segment < candidate.segments.length; segment += 1) {
      const prior = scores[term - 1]?.[segment - 1];
      if (prior !== undefined && prior > bestPreviousScore) {
        bestPreviousScore = prior;
        bestPreviousIndex = segment - 1;
      }
      const match = rows[term]?.[segment];
      if (!match || bestPreviousIndex < 0) continue;
      scores[term]![segment] =
        bestPreviousScore +
        match.score -
        (segment - bestPreviousIndex - 1) * 45;
      previous[term]![segment] = bestPreviousIndex;
    }
  }

  const lastScores = scores.at(-1) ?? [];
  let segmentIndex = -1;
  let best = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < lastScores.length; index += 1) {
    const leafBonus = index === candidate.segments.length - 1 ? 500 : 0;
    const score = (lastScores[index] ?? Number.NEGATIVE_INFINITY) + leafBonus;
    if (score > best) {
      best = score;
      segmentIndex = index;
    }
  }
  if (segmentIndex < 0 || !Number.isFinite(best)) return undefined;

  const result: TargetMatch[] = [];
  for (let term = terms.length - 1; term >= 0; term -= 1) {
    const match = rows[term]?.[segmentIndex];
    if (!match) return undefined;
    result.push(match);
    segmentIndex = previous[term]?.[segmentIndex] ?? -1;
  }
  return result.reverse();
}

function unorderedTermMatches(
  candidate: FileCompletionCandidate,
  terms: string[],
): TargetMatch[] | undefined {
  const options = terms.map((term) =>
    candidate.segments
      .map((_, segmentIndex) => matchSegment(candidate, term, segmentIndex))
      .filter((match): match is TargetMatch => Boolean(match))
      .sort((a, b) => b.score - a.score),
  );
  if (options.some((matches) => matches.length === 0)) return undefined;

  const order = terms
    .map((_, index) => index)
    .sort(
      (a, b) =>
        (options[a]?.length ?? 0) - (options[b]?.length ?? 0) ||
        (options[b]?.[0]?.score ?? 0) - (options[a]?.[0]?.score ?? 0),
    );
  const remainingBest = Array(order.length + 1).fill(0) as number[];
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const termIndex = order[index] ?? 0;
    remainingBest[index] =
      (remainingBest[index + 1] ?? 0) + (options[termIndex]?.[0]?.score ?? 0);
  }
  let bestScore = Number.NEGATIVE_INFINITY;
  let best: TargetMatch[] | undefined;

  function assign(
    orderIndex: number,
    usedSegments: Set<number>,
    chosen: TargetMatch[],
    score: number,
  ): void {
    if (score + (remainingBest[orderIndex] ?? 0) <= bestScore) return;
    if (orderIndex === order.length) {
      if (score > bestScore) {
        bestScore = score;
        best = [...chosen];
      }
      return;
    }
    const termIndex = order[orderIndex] ?? 0;
    for (const match of options[termIndex] ?? []) {
      if (usedSegments.has(match.segmentIndex)) continue;
      usedSegments.add(match.segmentIndex);
      chosen[termIndex] = match;
      assign(orderIndex + 1, usedSegments, chosen, score + match.score);
      usedSegments.delete(match.segmentIndex);
    }
  }

  assign(0, new Set(), [], 0);
  return best;
}

function matchSegment(
  candidate: FileCompletionCandidate,
  term: string,
  segmentIndex: number,
): TargetMatch | undefined {
  const segment = candidate.segments[segmentIndex] ?? "";
  const isLeaf = segmentIndex === candidate.segments.length - 1;
  const offset = 1 + segmentOffset(candidate, segmentIndex);
  const values = [{ value: segment, weight: isLeaf ? 1_500 : 350 }];
  if (isLeaf && candidate.kind === "file" && candidate.stem !== segment) {
    values.push({ value: candidate.stem, weight: 1_900 });
  }

  let best: LocalMatch | undefined;
  for (const target of values) {
    const match = matchText(term, target.value);
    if (!match) continue;
    const weighted = { ...match, score: match.score + target.weight };
    if (!best || weighted.score > best.score) best = weighted;
  }
  if (!best) return undefined;
  return {
    score: best.score,
    ranges: best.ranges.map(([from, to]) => [offset + from, offset + to]),
    segmentIndex,
  };
}

function matchText(term: string, value: string): LocalMatch | undefined {
  if (!term || !value) return undefined;
  const needle = term.toLowerCase();
  const haystack = value.toLowerCase();
  if (needle === haystack) {
    return {
      score: 3_600 + caseBonus(term, value),
      ranges: [[0, value.length]],
    };
  }
  if (haystack.startsWith(needle)) {
    return {
      score: 3_000 + caseBonus(term, value.slice(0, term.length)),
      ranges: [[0, term.length]],
    };
  }
  const index = haystack.indexOf(needle);
  if (index >= 0) {
    return {
      score:
        2_350 +
        (isWordBoundary(value, index) ? 300 : 0) -
        index * 10 +
        caseBonus(term, value.slice(index, index + term.length)),
      ranges: [[index, index + term.length]],
    };
  }
  const fuzzy = fuzzySubsequence(term, value);
  if (!fuzzy || fuzzy.score < 250) return undefined;
  return fuzzy;
}

function fuzzySubsequence(
  needle: string,
  haystack: string,
): LocalMatch | undefined {
  if (needle.length > haystack.length || haystack.length > 512)
    return undefined;
  const needleLower = needle.toLowerCase();
  const haystackLower = haystack.toLowerCase();
  let searchFrom = 0;
  for (const character of needleLower) {
    searchFrom = haystackLower.indexOf(character, searchFrom);
    if (searchFrom < 0) return undefined;
    searchFrom += 1;
  }

  const scores = Array.from(
    { length: needle.length },
    () => Array(haystack.length).fill(Number.NEGATIVE_INFINITY) as number[],
  );
  const previous = Array.from(
    { length: needle.length },
    () => Array(haystack.length).fill(-1) as number[],
  );

  for (let column = 0; column < haystack.length; column += 1) {
    if (needleLower[0] !== haystackLower[column]) continue;
    scores[0]![column] =
      420 +
      (isWordBoundary(haystack, column) ? 260 : 0) -
      column * 12 +
      characterCaseBonus(needle[0] ?? "", haystack[column] ?? "");
  }

  for (let row = 1; row < needle.length; row += 1) {
    let bestGapScore = Number.NEGATIVE_INFINITY;
    let bestGapIndex = -1;
    for (let column = 0; column < haystack.length; column += 1) {
      const gapCandidate = scores[row - 1]?.[column - 2];
      if (gapCandidate !== undefined) {
        const normalized = gapCandidate + (column - 2) * 18;
        if (normalized > bestGapScore) {
          bestGapScore = normalized;
          bestGapIndex = column - 2;
        }
      }
      if (needleLower[row] !== haystackLower[column]) continue;

      const boundaryBonus = isWordBoundary(haystack, column) ? 170 : 0;
      const exactCaseBonus = characterCaseBonus(
        needle[row] ?? "",
        haystack[column] ?? "",
      );
      const consecutive = scores[row - 1]?.[column - 1];
      let score =
        consecutive === undefined || !Number.isFinite(consecutive)
          ? Number.NEGATIVE_INFINITY
          : consecutive + 260 + boundaryBonus + exactCaseBonus;
      let predecessor = column - 1;
      if (Number.isFinite(bestGapScore)) {
        const gapped =
          bestGapScore - (column - 1) * 18 + boundaryBonus + exactCaseBonus;
        if (gapped > score) {
          score = gapped;
          predecessor = bestGapIndex;
        }
      }
      scores[row]![column] = score;
      previous[row]![column] = predecessor;
    }
  }

  const lastRow = scores.at(-1) ?? [];
  let bestScore = Number.NEGATIVE_INFINITY;
  let column = -1;
  for (let index = 0; index < lastRow.length; index += 1) {
    const score = (lastRow[index] ?? Number.NEGATIVE_INFINITY) - index * 2;
    if (score > bestScore) {
      bestScore = score;
      column = index;
    }
  }
  if (column < 0 || !Number.isFinite(bestScore)) return undefined;

  const indices: number[] = [];
  for (let row = needle.length - 1; row >= 0; row -= 1) {
    indices.push(column);
    column = previous[row]?.[column] ?? -1;
  }
  indices.reverse();
  return { score: bestScore, ranges: indicesToRanges(indices) };
}

function caseBonus(term: string, matched: string): number {
  return term === matched ? 80 : 0;
}

function characterCaseBonus(needle: string, matched: string): number {
  return needle === matched ? 25 : 0;
}

function isWordBoundary(value: string, index: number): boolean {
  if (index <= 0) return true;
  const previous = value[index - 1] ?? "";
  const current = value[index] ?? "";
  return (
    /[-_./\s]/.test(previous) ||
    (/[a-z0-9]/.test(previous) && /[A-Z]/.test(current)) ||
    (/[A-Za-z]/.test(previous) && /\d/.test(current))
  );
}

function segmentOffset(
  candidate: FileCompletionCandidate,
  segmentIndex: number,
): number {
  let offset = 0;
  for (let index = 0; index < segmentIndex; index += 1) {
    offset += (candidate.segments[index]?.length ?? 0) + 1;
  }
  return offset;
}

function indicesToRanges(indices: number[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const index of indices) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === index) last[1] = index + 1;
    else ranges.push([index, index + 1]);
  }
  return ranges;
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}
