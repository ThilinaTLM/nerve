import type { TextLimitSnapshotPayload } from "@nervekit/contracts";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatByteSize,
  PROCESS_PREVIEW_MAX_LINE_CHARS,
  type TruncationDirection,
  truncateHead,
  truncateLine,
} from "./truncate.js";

export const MODEL_TOOL_RESULT_MAX_BYTES = 24_000;
export const MODEL_TEXT_MAX_LINES = 1000;
export const MODEL_TEXT_MAX_LINE_CHARS = 4096;

export const FILE_OUTPUT_MAX_LINE_CHARS = MODEL_TEXT_MAX_LINE_CHARS;
export const PROCESS_INLINE_MAX_LINE_CHARS = Math.max(
  PROCESS_PREVIEW_MAX_LINE_CHARS,
  2000,
);
export const LIVE_OUTPUT_MAX_BYTES = 8 * 1024;
export const LIVE_OUTPUT_MAX_LINES = 200;
export const LIVE_OUTPUT_MAX_LINE_CHARS = 1000;

export type TextBudget = {
  maxBytes?: number;
  maxLines?: number;
  maxLineChars?: number;
};

export type BoundedTextResult = {
  text: string;
  truncated: boolean;
  omittedLines: number;
  omittedBytes: number;
  omittedChars: number;
  truncatedLines: number;
  direction: TruncationDirection;
  partialLine?: boolean;
  maxBytes: number;
  maxLines: number;
  maxLineChars: number;
  originalBytes: number;
  originalChars: number;
  originalLines: number;
  displayedBytes: number;
  displayedChars: number;
  displayedLines: number;
};

export type TextBoundaryDetails = Omit<BoundedTextResult, "text">;

export type TextContentBlockLike = { type: "text"; text: string };
export type ImageContentBlockLike = {
  type: "image";
  data: string;
  mimeType: string;
};
export type ContentBlockLike = TextContentBlockLike | ImageContentBlockLike;

export type BoundedContentBlocksResult<T extends ContentBlockLike> = {
  contentBlocks: T[];
  truncated: boolean;
  truncations: TextBoundaryDetails[];
};

export function boundText(
  input: string,
  budget: TextBudget = {},
): BoundedTextResult {
  const maxLines = sanitizePositiveInteger(budget.maxLines, DEFAULT_MAX_LINES);
  const maxBytes = sanitizePositiveInteger(budget.maxBytes, DEFAULT_MAX_BYTES);
  const maxLineChars = sanitizePositiveInteger(
    budget.maxLineChars,
    FILE_OUTPUT_MAX_LINE_CHARS,
  );
  const originalBytes = byteLength(input);
  const originalChars = input.length;
  const originalLines = countLines(input);
  const lines = splitLines(input);
  const selected = lines.slice(0, maxLines);
  let omittedLines = Math.max(0, lines.length - selected.length);
  let omittedBytes =
    omittedLines > 0 ? byteLength(lines.slice(maxLines).join("\n")) : 0;
  if (omittedLines > 0 && maxLines > 0) omittedBytes += 1;
  let truncatedLines = 0;

  const lineBounded = selected.map((line) => {
    const truncated = truncateLine(line, maxLineChars);
    if (truncated.truncated) {
      truncatedLines += 1;
      omittedBytes += truncated.omittedBytes;
    }
    return truncated.text;
  });

  const byteBounded = truncateHead(lineBounded.join("\n"), {
    maxLines: Number.MAX_SAFE_INTEGER,
    maxBytes,
  });
  omittedLines += byteBounded.omittedLines;
  omittedBytes += byteBounded.omittedBytes;

  const text = byteBounded.text;
  const displayedChars = text.length;
  const omittedChars = Math.max(0, originalChars - displayedChars);
  const truncated = omittedLines > 0 || omittedBytes > 0 || truncatedLines > 0;
  const lineOnly =
    truncatedLines > 0 &&
    omittedLines === 0 &&
    byteBounded.omittedBytes === 0 &&
    !byteBounded.partialLine;

  return {
    text,
    truncated,
    omittedLines,
    omittedBytes,
    omittedChars,
    truncatedLines,
    direction: lineOnly ? "line" : "head",
    partialLine: byteBounded.partialLine,
    maxBytes,
    maxLines,
    maxLineChars,
    originalBytes,
    originalChars,
    originalLines,
    displayedBytes: byteLength(text),
    displayedChars,
    displayedLines: countLines(text),
  };
}

export function textBoundaryDetails(
  bounded: BoundedTextResult,
): TextBoundaryDetails {
  const details = { ...bounded };
  Reflect.deleteProperty(details, "text");
  return details;
}

export function textLimitSnapshot(
  bounded: BoundedTextResult,
): TextLimitSnapshotPayload {
  return {
    truncated: bounded.truncated,
    direction: bounded.direction,
    originalBytes: bounded.originalBytes,
    displayedBytes: bounded.displayedBytes,
    omittedBytes: bounded.omittedBytes,
    originalChars: bounded.originalChars,
    displayedChars: bounded.displayedChars,
    omittedChars: bounded.omittedChars,
    originalLines: bounded.originalLines,
    displayedLines: bounded.displayedLines,
    omittedLines: bounded.omittedLines,
    truncatedLines: bounded.truncatedLines,
    maxBytes: bounded.maxBytes,
    maxLines: bounded.maxLines,
    maxLineChars: bounded.maxLineChars,
    partialLine: bounded.partialLine,
  };
}

export function appendBoundedTextNotice(
  bounded: BoundedTextResult,
  options: { label?: string; recoveryHint?: string } = {},
): string {
  if (!bounded.truncated) return bounded.text;
  const notice = formatBoundedTextNotice(bounded, options);
  return bounded.text.length > 0 ? `${bounded.text}\n\n${notice}` : notice;
}

export function formatBoundedTextNotice(
  bounded: BoundedTextResult,
  options: { label?: string; recoveryHint?: string } = {},
): string {
  const parts: string[] = [];
  if (bounded.truncatedLines > 0) {
    parts.push(
      `${bounded.truncatedLines} overlong line${bounded.truncatedLines === 1 ? "" : "s"} capped at ${bounded.maxLineChars} characters`,
    );
  }
  if (bounded.omittedLines > 0) {
    parts.push(
      `${bounded.omittedLines} omitted line${bounded.omittedLines === 1 ? "" : "s"}`,
    );
  }
  if (bounded.omittedBytes > 0) {
    parts.push(`${formatByteSize(bounded.omittedBytes)} omitted`);
  }
  const subject = options.label ?? "output";
  const summary = parts.length > 0 ? parts.join(", ") : "bounded";
  const hint = options.recoveryHint ? ` ${options.recoveryHint}` : "";
  return `[...${subject} truncated: ${summary}.${hint}]`;
}

export function boundContentBlocks<T extends ContentBlockLike>(
  blocks: readonly T[],
  budget: TextBudget = {},
  options: { recoveryHint?: string } = {},
): BoundedContentBlocksResult<T> {
  const textBlocks = blocks.filter(
    (block): block is T & TextContentBlockLike => block.type === "text",
  );
  if (textBlocks.length === 0) {
    return { contentBlocks: [...blocks], truncated: false, truncations: [] };
  }

  const maxBytes = sanitizePositiveInteger(
    budget.maxBytes,
    MODEL_TOOL_RESULT_MAX_BYTES,
  );
  const maxLines = sanitizePositiveInteger(
    budget.maxLines,
    MODEL_TEXT_MAX_LINES,
  );
  const maxLineChars = sanitizePositiveInteger(
    budget.maxLineChars,
    MODEL_TEXT_MAX_LINE_CHARS,
  );
  const aggregate = boundText(
    textBlocks.map((block) => block.text).join("\n"),
    { maxBytes, maxLines, maxLineChars },
  );
  if (!aggregate.truncated) {
    return { contentBlocks: [...blocks], truncated: false, truncations: [] };
  }

  const rawNotice = formatBoundedTextNotice(aggregate, {
    label: "tool result",
    recoveryHint: options.recoveryHint,
  });
  const notice = boundText(rawNotice, {
    maxBytes,
    maxLines: 1,
    maxLineChars: Math.min(maxLineChars, maxBytes),
  }).text;
  const noticeBytes = byteLength(notice);
  const separatorBytes = Math.max(0, textBlocks.length - 1);
  const canShowContent =
    maxBytes > noticeBytes + separatorBytes + 2 && maxLines > 2;
  let remainingBytes = canShowContent
    ? maxBytes - noticeBytes - separatorBytes - 2
    : 0;
  let remainingLines = canShowContent ? maxLines - 2 : 0;
  let exhausted = !canShowContent;
  let lastVisibleBlock = -1;
  const contentBlocks = blocks.map((block, blockIndex) => {
    if (block.type !== "text") return block;
    if (exhausted || remainingBytes <= 0 || remainingLines <= 0) {
      exhausted = true;
      return { ...block, text: "" };
    }
    const bounded = boundText(block.text, {
      maxBytes: remainingBytes,
      maxLines: remainingLines,
      maxLineChars,
    });
    remainingBytes = Math.max(0, remainingBytes - bounded.displayedBytes);
    remainingLines = Math.max(0, remainingLines - bounded.displayedLines);
    if (bounded.text.length > 0) lastVisibleBlock = blockIndex;
    if (bounded.truncated) exhausted = true;
    return { ...block, text: bounded.text };
  }) as T[];

  const noticeBlockIndex =
    lastVisibleBlock >= 0
      ? lastVisibleBlock
      : contentBlocks.findIndex((block) => block.type === "text");
  const noticeBlock = contentBlocks[noticeBlockIndex];
  if (noticeBlock?.type === "text") {
    contentBlocks[noticeBlockIndex] = {
      ...noticeBlock,
      text:
        noticeBlock.text.length > 0
          ? `${noticeBlock.text}\n\n${notice}`
          : notice,
    } as T;
  }

  return {
    contentBlocks,
    truncated: true,
    truncations: [textBoundaryDetails(aggregate)],
  };
}

export function boundLiveOutputChunk(chunk: string): string {
  const bounded = boundText(chunk, {
    maxBytes: LIVE_OUTPUT_MAX_BYTES,
    maxLines: LIVE_OUTPUT_MAX_LINES,
    maxLineChars: LIVE_OUTPUT_MAX_LINE_CHARS,
  });
  return appendBoundedTextNotice(bounded, {
    label: "live output chunk",
    recoveryHint: "Full output is preserved for the final result/transcript.",
  });
}

function sanitizePositiveInteger(value: number | undefined, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const withoutFinalNewline = text.endsWith("\n") ? text.slice(0, -1) : text;
  return withoutFinalNewline.length === 0
    ? [""]
    : withoutFinalNewline.split("\n");
}

function countLines(text: string): number {
  return splitLines(text).length;
}

function byteLength(input: string): number {
  return Buffer.byteLength(input, "utf8");
}
