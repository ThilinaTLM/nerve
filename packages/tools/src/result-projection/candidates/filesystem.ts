import type { ExactContinuation } from "@nervekit/contracts/tools";
import { fallbackText, validContentBlocks } from "../fallback.js";
import type {
  CandidateContext,
  ProjectableBlock,
  ProjectionCandidate,
  SemanticItem,
} from "../types.js";
import { artifacts } from "../candidate-artifacts.js";
import { count, textOf, record, string, number } from "../candidate-values.js";

export function sourceCandidate(
  context: CandidateContext,
): ProjectionCandidate | undefined {
  const result = record(context.result);
  const blocks = validContentBlocks(result);
  const content =
    typeof result.content === "string" ? result.content : undefined;
  if (!blocks && content === undefined) return;
  const details = record(result.details);
  const range = record(details.range);
  const truncation = record(details.truncation);
  const continuation: ExactContinuation[] = [];
  const nextOffset =
    number(range.nextOffset) ??
    number(truncation.nextOffset) ??
    number(record(record(details.outputLimits).continuation).nextOffset);
  const nextByteOffset =
    number(range.nextByteOffset) ??
    number(truncation.nextByteOffset) ??
    number(record(record(details.outputLimits).continuation).nextByteOffset);
  const totalLines = number(range.sourceTotalLines);
  const totalBytes = number(range.sourceBytes);
  if (nextOffset !== undefined) {
    continuation.push({
      kind: "line",
      nextOffset,
      displayedStart:
        number(range.returnedStartLine) ??
        number(range.requestedStartLine) ??
        1,
      displayedEnd:
        number(range.returnedEndLine) ?? Math.max(0, nextOffset - 1),
      total:
        totalLines ??
        Math.max(nextOffset, number(truncation.originalLines) ?? nextOffset),
    });
  } else if (nextByteOffset !== undefined) {
    continuation.push({
      kind: "byte",
      nextByteOffset,
      displayedStart:
        number(range.utf8AdjustedStart) ?? number(range.returnedByteStart) ?? 0,
      displayedEnd:
        number(range.utf8AdjustedEnd) ??
        number(range.returnedByteEnd) ??
        nextByteOffset,
      total:
        totalBytes ??
        Math.max(
          nextByteOffset,
          number(truncation.originalBytes) ?? nextByteOffset,
        ),
    });
  }
  const canonicalBlocks = blocks ?? [
    { type: "text" as const, text: content ?? "" },
  ];
  return {
    blocks: canonicalBlocks,
    continuation,
    artifacts: artifacts(context),
  };
}

/** Top groups by count, then "N other <plural> M": `src/a.ts 120, src/b.ts 95, 3 other files 40`. */
function groupCounts(
  keys: readonly string[],
  plural: string,
  top = 3,
): { text: string; groups: number } {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  const shown = sorted.slice(0, top).map(([key, n]) => `${key} ${n}`);
  const rest = sorted.slice(top);
  if (rest.length > 0) {
    shown.push(
      `${rest.length} other ${plural} ${rest.reduce((sum, [, n]) => sum + n, 0)}`,
    );
  }
  return { text: shown.join(", "), groups: sorted.length };
}

/**
 * Tells the agent how to narrow a cut listing. The counts cover the items the tool collected,
 * so they are labelled with that number when the tool's own limit stopped collection.
 */
function narrowingGuidance(
  keys: readonly string[],
  total: number,
  groupLabel: { title: string; plural: string },
  advice: string,
): string {
  const { text, groups } = groupCounts(keys, groupLabel.plural);
  const scope = total > keys.length ? ` (first ${keys.length})` : "";
  return groups > 1
    ? `${groupLabel.title}${scope}: ${text}. ${advice}`
    : advice;
}

function cutFooter(
  displayed: number,
  total: number,
  plural: string,
  guidance: string,
): string | undefined {
  return total > displayed
    ? `Showing ${displayed} of ${total} ${plural}. ${guidance}`
    : undefined;
}

export function listingCandidate(
  context: CandidateContext,
): ProjectionCandidate | undefined {
  const result = record(context.result);
  const details = record(result.details);
  if (!Array.isArray(result.entries)) return;
  const root = typeof result.path === "string" ? result.path : ".";
  const items: SemanticItem[] = result.entries.map((entry, index) => {
    const value = record(entry);
    const path =
      typeof value.path === "string" ? value.path : fallbackText(entry);
    const kind = typeof value.kind === "string" ? ` (${value.kind})` : "";
    return {
      id: String(index),
      countsAs: "item",
      blocks: [{ type: "text", text: `${path}${kind}` }],
    };
  });
  const original =
    number(details.totalEntries) ??
    number(details.total) ??
    number(result.total) ??
    items.length;
  const paths = result.entries.map((entry) => string(record(entry).path));
  const guidance =
    context.toolName === "ls"
      ? "List a subdirectory or use find with a pattern."
      : narrowingGuidance(
          paths.map((path) =>
            path.includes("/") ? `${path.split("/")[0]}/` : "./",
          ),
          original,
          { title: "By dir", plural: "dirs" },
          "Narrow with path or a tighter pattern.",
        );
  const footer = cutFooter(items.length, original, "entries", guidance);
  const blocks: ProjectableBlock[] = [
    {
      type: "text",
      text: [
        `Root: ${root}`,
        ...items.map((item) => textOf(item.blocks)),
        footer,
      ]
        .filter((value): value is string => Boolean(value))
        .join("\n"),
    },
  ];
  return {
    blocks,
    status: [{ type: "text", text: `Root: ${root}` }],
    items,
    overflow: { noun: "entry", guidance },
    counts: [count("item", original, items.length)],
    artifacts: artifacts(context),
  };
}

export function grepCandidate(
  context: CandidateContext,
): ProjectionCandidate | undefined {
  const result = record(context.result);
  const details = record(result.details);
  if (!Array.isArray(result.matches)) return;
  const root = typeof result.path === "string" ? result.path : ".";
  const items: SemanticItem[] = result.matches.map((match, index) => {
    const value = record(match);
    const path = string(value.path) || root;
    const line = number(value.line) ?? number(value.lineNumber);
    const text = string(value.text) || fallbackText(match);
    return {
      id: `${path}:${line ?? index}`,
      countsAs: "item",
      blocks: [
        {
          type: "text",
          text: `${path}${line !== undefined ? `:${line}` : ""}: ${text}`,
        },
      ],
    };
  });
  const original =
    number(details.totalMatches) ??
    number(details.total) ??
    number(result.total) ??
    items.length;
  const guidance = narrowingGuidance(
    result.matches.map((match) => string(record(match).path) || root),
    original,
    { title: "By file", plural: "files" },
    "Narrow with path, glob or a tighter pattern.",
  );
  const footer = cutFooter(items.length, original, "matches", guidance);
  // The executor's one-line note about cut lines carries a copyable `read` call.
  const longLineNote = string(result.content)
    .split("\n")
    .find((line) => / cut to \d+ chars\. Next: read \{/.test(line));
  return {
    blocks: [
      {
        type: "text",
        text: [
          `Root: ${root}`,
          ...items.map((item) => textOf(item.blocks)),
          footer,
          longLineNote,
        ]
          .filter((value): value is string => Boolean(value))
          .join("\n"),
      },
    ],
    status: [
      {
        type: "text",
        text: [`Root: ${root}`, longLineNote].filter(Boolean).join("\n"),
      },
    ],
    items,
    overflow: { noun: "match", guidance },
    counts: [count("item", original, items.length)],
    artifacts: artifacts(context),
  };
}
