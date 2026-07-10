export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024;
export const GREP_MAX_LINE_LENGTH = 500;

export const PROCESS_INLINE_MAX_BYTES = 32 * 1024;
export const PROCESS_INLINE_MAX_LINES = 500;
export const PROCESS_PREVIEW_EDGE_LINES = 40;
export const PROCESS_PREVIEW_EDGE_MAX_BYTES = 8 * 1024;
export const PROCESS_PREVIEW_MAX_LINE_CHARS = 500;

export type TruncationDirection = "head" | "tail" | "line" | "head_tail";

export type TruncationResult = {
  text: string;
  truncated: boolean;
  omittedLines: number;
  omittedBytes: number;
  direction: TruncationDirection;
  partialLine?: boolean;
};

type TruncateOptions = {
  maxLines?: number;
  maxBytes?: number;
};

export function truncateHead(
  input: string,
  options: TruncateOptions = {},
): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const lines = input.split("\n");
  const selected = lines.slice(0, maxLines);
  let text = selected.join("\n");
  let omittedLines = Math.max(0, lines.length - selected.length);
  let omittedBytes = 0;

  while (byteLength(text) > maxBytes && selected.length > 1) {
    const removed = selected.pop() ?? "";
    omittedLines += 1;
    omittedBytes += byteLength(removed) + 1;
    text = selected.join("\n");
  }

  let partialLine = false;
  if (byteLength(text) > maxBytes) {
    const truncated = truncateUtf8Bytes(text, maxBytes);
    omittedBytes += byteLength(text) - byteLength(truncated);
    text = truncated;
    partialLine = true;
  }

  return {
    text,
    truncated: omittedLines > 0 || omittedBytes > 0,
    omittedLines,
    omittedBytes,
    direction: "head",
    partialLine: partialLine || undefined,
  };
}

export function truncateTail(
  input: string,
  options: TruncateOptions = {},
): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const lines = input.split("\n");
  const selected = lines.slice(Math.max(0, lines.length - maxLines));
  let text = selected.join("\n");
  let omittedLines = Math.max(0, lines.length - selected.length);
  let omittedBytes = 0;

  while (byteLength(text) > maxBytes && selected.length > 0) {
    const removed = selected.shift() ?? "";
    omittedLines += 1;
    omittedBytes += byteLength(removed) + 1;
    text = selected.join("\n");
  }

  if (byteLength(text) > maxBytes) {
    const bytes = Buffer.from(text, "utf8");
    const truncated = bytes.subarray(bytes.length - maxBytes).toString("utf8");
    omittedBytes += byteLength(text) - byteLength(truncated);
    text = truncated;
  }

  return {
    text,
    truncated: omittedLines > 0 || omittedBytes > 0,
    omittedLines,
    omittedBytes,
    direction: "tail",
  };
}

export function truncateLine(
  input: string,
  maxChars = GREP_MAX_LINE_LENGTH,
): TruncationResult {
  if (input.length <= maxChars) {
    return {
      text: input,
      truncated: false,
      omittedLines: 0,
      omittedBytes: 0,
      direction: "line",
    };
  }
  const omitted = input.slice(maxChars);
  return {
    text: `${input.slice(0, maxChars)}…[truncated ${omitted.length} chars]`,
    truncated: true,
    omittedLines: 0,
    omittedBytes: byteLength(omitted),
    direction: "line",
  };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function truncateUtf8Bytes(input: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const bytes = Buffer.from(input, "utf8");
  if (bytes.length <= maxBytes) return input;

  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return bytes.subarray(0, end).toString("utf8");
}

function byteLength(input: string): number {
  return Buffer.byteLength(input, "utf8");
}
