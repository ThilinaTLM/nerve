import { extname, isAbsolute } from "node:path";
import type { CompletionItem } from "@nervekit/shared";
import type { FileCompletionCandidate } from "./file-completion-candidates.js";

export const defaultCompletionLimit = 60;

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
  index: number;
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

  return ranked
    .slice(0, options.limit ?? defaultCompletionLimit)
    .map(toCompletionItem);
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
  const pathLower = candidate.relativePath.toLowerCase();
  const nameLower = candidate.name.toLowerCase();
  const queryWithoutTrailingSlash = queryLower.replace(/\/+$/, "");
  const folderIntent = query.endsWith("/");

  if (folderIntent && pathLower === queryWithoutTrailingSlash) return undefined;

  if (pathLower === queryWithoutTrailingSlash) {
    return {
      candidate,
      score: 14_000 + kindBoost(candidate, folderIntent) - candidate.depth,
      matchRanges: [
        [1, Math.min(label.length, 1 + queryWithoutTrailingSlash.length)],
      ],
    };
  }

  if (nameLower === queryLower) {
    const offset = labelNameOffset(candidate);
    return {
      candidate,
      score: 13_000 + kindBoost(candidate, folderIntent) - candidate.depth,
      matchRanges: [[offset, offset + candidate.name.length]],
    };
  }

  if (pathLower.startsWith(queryLower)) {
    const remainder = pathLower.slice(queryLower.length).replace(/^\/+/, "");
    const remainingDepth = remainder ? remainder.split("/").length : 0;
    return {
      candidate,
      score:
        12_000 +
        kindBoost(candidate, folderIntent) -
        remainingDepth * 120 -
        candidate.depth * 6 -
        candidate.relativePath.length / 20,
      matchRanges: [[1, Math.min(label.length, 1 + query.length)]],
    };
  }

  const terms = query
    .split(/[\s/]+/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (terms.length === 0) return rankEmptyCandidate(candidate);

  const targets = targetsFor(candidate, query.includes("/"));
  const matches: TargetMatch[] = [];

  for (const term of terms) {
    const match = bestMatchForTerm(term, targets);
    if (!match) return undefined;
    matches.push(match);
  }

  const score =
    5_000 +
    matches.reduce((total, match) => total + match.score, 0) +
    orderedTermBoost(matches) +
    kindBoost(candidate, folderIntent) -
    candidate.depth * 14 -
    candidate.relativePath.length / 10;

  return {
    candidate,
    score,
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

type MatchTarget = {
  value: string;
  labelOffset: number;
  weight: number;
  scope: "stem" | "name" | "segment" | "path";
};

function stemOf(name: string): string {
  const extension = extname(name);
  return extension ? name.slice(0, -extension.length) : name;
}

function targetsFor(
  candidate: FileCompletionCandidate,
  includeFullPath: boolean,
): MatchTarget[] {
  const targets: MatchTarget[] = [];
  const nameOffset = labelNameOffset(candidate);
  const stem =
    candidate.kind === "file" ? stemOf(candidate.name) : candidate.name;

  targets.push({
    value: stem,
    labelOffset: nameOffset,
    weight: 900,
    scope: "stem",
  });

  if (stem !== candidate.name) {
    targets.push({
      value: candidate.name,
      labelOffset: nameOffset,
      weight: 760,
      scope: "name",
    });
  }

  let offset = 0;
  for (const segment of candidate.relativePath.split("/")) {
    const isLeaf = offset + segment.length === candidate.relativePath.length;
    const segmentStem =
      isLeaf && candidate.kind === "file" ? stemOf(segment) : segment;
    targets.push({
      value: segmentStem,
      labelOffset: 1 + offset,
      weight: isLeaf ? 820 : 560,
      scope: "segment",
    });
    if (segmentStem !== segment) {
      targets.push({
        value: segment,
        labelOffset: 1 + offset,
        weight: isLeaf ? 700 : 500,
        scope: "segment",
      });
    }
    offset += segment.length + 1;
  }

  if (includeFullPath) {
    targets.push({
      value: candidate.relativePath,
      labelOffset: 1,
      weight: 300,
      scope: "path",
    });
  }

  return targets;
}

function bestMatchForTerm(
  term: string,
  targets: MatchTarget[],
): TargetMatch | undefined {
  let best: TargetMatch | undefined;
  for (const target of targets) {
    const match = matchTermInTarget(term, target);
    if (!match) continue;
    if (!best || match.score > best.score) best = match;
  }
  return best;
}

function matchTermInTarget(
  term: string,
  target: MatchTarget,
): TargetMatch | undefined {
  if (!term) return undefined;

  const termLower = term.toLowerCase();
  const valueLower = target.value.toLowerCase();
  const caseSensitiveQuery = /[A-Z]/.test(term);

  if (valueLower === termLower) {
    return {
      score:
        target.weight +
        3_000 +
        caseMatchBoost(target.value, term, 0, caseSensitiveQuery),
      ranges: [[target.labelOffset, target.labelOffset + term.length]],
      index: target.labelOffset,
    };
  }

  if (valueLower.startsWith(termLower)) {
    return {
      score:
        target.weight +
        2_400 +
        caseMatchBoost(target.value, term, 0, caseSensitiveQuery) -
        term.length / 10,
      ranges: [[target.labelOffset, target.labelOffset + term.length]],
      index: target.labelOffset,
    };
  }

  const substringIndex = valueLower.indexOf(termLower);
  if (substringIndex >= 0) {
    const boundary = isWordBoundary(target.value, substringIndex);
    return {
      score:
        target.weight +
        (boundary ? 2_150 : 1_650) +
        caseMatchBoost(target.value, term, substringIndex, caseSensitiveQuery) -
        substringIndex * (boundary ? 2 : 8) -
        term.length / 10,
      ranges: [
        [
          target.labelOffset + substringIndex,
          target.labelOffset + substringIndex + term.length,
        ],
      ],
      index: target.labelOffset + substringIndex,
    };
  }

  if (target.scope === "path" || term.length < 3) return undefined;

  const fuzzy = fuzzySubsequence(termLower, target.value);
  if (!fuzzy || fuzzy.score < 260) return undefined;

  return {
    score: target.weight + 620 + fuzzy.score,
    ranges: fuzzy.ranges.map(([from, to]) => [
      target.labelOffset + from,
      target.labelOffset + to,
    ]),
    index: target.labelOffset + fuzzy.firstIndex,
  };
}

function caseMatchBoost(
  value: string,
  term: string,
  index: number,
  caseSensitiveQuery: boolean,
): number {
  const exactCase = value.slice(index, index + term.length) === term;
  if (caseSensitiveQuery) return exactCase ? 520 : -760;
  return exactCase ? 80 : 0;
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

function fuzzySubsequence(
  needle: string,
  haystack: string,
):
  | { score: number; ranges: Array<[number, number]>; firstIndex: number }
  | undefined {
  const indices: number[] = [];
  const haystackLower = haystack.toLowerCase();
  let searchFrom = 0;

  for (const char of needle) {
    const index = haystackLower.indexOf(char, searchFrom);
    if (index < 0) return undefined;
    indices.push(index);
    searchFrom = index + 1;
  }

  const firstIndex = indices[0] ?? 0;
  let consecutive = 0;
  let boundaryHits = 0;
  let gapPenalty = 0;

  for (let index = 0; index < indices.length; index += 1) {
    const current = indices[index] ?? 0;
    const previous = indices[index - 1];
    if (previous !== undefined) {
      if (current === previous + 1) consecutive += 1;
      else gapPenalty += current - previous - 1;
    }
    if (isWordBoundary(haystack, current)) boundaryHits += 1;
  }

  return {
    score:
      180 +
      consecutive * 35 +
      boundaryHits * 45 -
      firstIndex * 4 -
      gapPenalty * 3,
    ranges: indicesToRanges(indices),
    firstIndex,
  };
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

function orderedTermBoost(matches: TargetMatch[]): number {
  if (matches.length <= 1) return 0;
  for (let index = 1; index < matches.length; index += 1) {
    if ((matches[index]?.index ?? 0) < (matches[index - 1]?.index ?? 0)) {
      return 0;
    }
  }
  return 240;
}
