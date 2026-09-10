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
  } else if (
    range.mode === "lines" &&
    number(range.returnedContentLines) !== undefined &&
    number(range.returnedContentLines)! > 200
  ) {
    const start = number(range.returnedStartLine) ?? 1;
    const total = totalLines ?? start + number(range.returnedContentLines)! - 1;
    continuation.push({
      kind: "line",
      nextOffset: start + 200,
      displayedStart: start,
      displayedEnd: start + 199,
      total,
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
  if (typeof range.mode === "string" && canonicalBlocks[0]?.type === "text") {
    const rangeLine =
      range.mode === "lines"
        ? `Range: lines ${String(range.returnedStartLine ?? 1)}-${String(range.returnedEndLine ?? 0)} of ${String(range.sourceTotalLines ?? "unknown")}.`
        : `Range: bytes ${String(range.utf8AdjustedStart ?? range.returnedByteStart ?? 0)}-${String(range.utf8AdjustedEnd ?? range.returnedByteEnd ?? 0)} of ${String(range.sourceBytes ?? "unknown")}.`;
    canonicalBlocks[0] = {
      type: "text",
      text: `${canonicalBlocks[0].text}\n${rangeLine}`,
    };
  }
  return {
    blocks: canonicalBlocks,
    continuation,
    artifacts: artifacts(context),
  };
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
  const footer =
    original > items.length
      ? `Showing ${items.length} of ${original} entries; ${original - items.length} omitted by the requested limit.`
      : undefined;
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
    overflow: {
      noun: "entry",
      guidance:
        "Refine the requested path/pattern or inspect the complete result payload.",
    },
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
  const producerNotice =
    details.producerLimitReached === true
      ? "Producer match limit reached; increase limit or refine the pattern for additional matches."
      : undefined;
  return {
    blocks: [
      {
        type: "text",
        text: [
          `Root: ${root}`,
          ...items.map((item) => textOf(item.blocks)),
          producerNotice,
        ]
          .filter((value): value is string => Boolean(value))
          .join("\n"),
      },
    ],
    status: [{ type: "text", text: `Root: ${root}` }],
    items,
    overflow: {
      noun: "match",
      guidance:
        "Refine the pattern or inspect the complete result payload for omitted matches.",
    },
    counts: [
      count(
        "item",
        number(details.totalMatches) ??
          number(details.total) ??
          number(result.total) ??
          items.length,
        items.length,
      ),
    ],
    artifacts: artifacts(context),
  };
}
