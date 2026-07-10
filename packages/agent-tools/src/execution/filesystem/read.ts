import { readFile } from "node:fs/promises";
import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { numberArg } from "../common/args.js";
import {
  type BoundedTextResult,
  boundText,
  FILE_OUTPUT_MAX_LINE_CHARS,
  textBoundaryDetails,
  textLimitSnapshot,
} from "../common/output-budget.js";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
} from "../common/truncate.js";
import {
  isErrnoException,
  pathNotFoundMessage,
  resolveReadPath,
} from "./path.js";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const READ_BYTE_DEFAULT_LIMIT = FILE_OUTPUT_MAX_LINE_CHARS;
const READ_BYTE_MAX_LIMIT = FILE_OUTPUT_MAX_LINE_CHARS;

function startsWith(buffer: Uint8Array, bytes: number[]): boolean {
  if (buffer.length < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}

function startsWithAscii(
  buffer: Uint8Array,
  offset: number,
  text: string,
): boolean {
  if (buffer.length < offset + text.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (buffer[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

function detectSupportedImageMimeType(buffer: Uint8Array): string | null {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(buffer, PNG_SIGNATURE)) return "image/png";
  if (startsWithAscii(buffer, 0, "GIF")) return "image/gif";
  if (
    startsWithAscii(buffer, 0, "RIFF") &&
    startsWithAscii(buffer, 8, "WEBP")
  ) {
    return "image/webp";
  }
  return null;
}

export async function executeRead(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const path = await resolveReadPath(context.cwd, args.path);
  const buffer = await readFile(path).catch((error: unknown) => {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new Error(pathNotFoundMessage("read", args.path, path));
    }
    throw error;
  });
  const hasByteOffset = typeof args.byteOffset === "number";
  const hasByteLimit = typeof args.byteLimit === "number";
  const hasByteRange = hasByteOffset || hasByteLimit;
  const hasExplicitLimit = typeof args.limit === "number";
  const hasExplicitOffset = typeof args.offset === "number";

  if (hasByteRange && (hasExplicitLimit || hasExplicitOffset)) {
    throw new Error(
      "Use either line arguments ('offset'/'limit') or byte arguments ('byteOffset'/'byteLimit'), not both.",
    );
  }

  const mimeType = detectSupportedImageMimeType(buffer);

  if (mimeType && !hasByteRange) {
    const content = `Read image file [${mimeType}]`;
    return {
      path,
      content,
      contentBlocks: [
        { type: "text", text: content },
        { type: "image", data: buffer.toString("base64"), mimeType },
      ],
    };
  }

  if (hasByteRange) return readByteRange(path, buffer, args);

  const content = buffer.toString("utf8");
  const lines = content.split(/\r?\n/);
  const offset = numberArg(args.offset, 1);

  if (hasExplicitLimit || hasExplicitOffset) {
    const limit = Math.min(numberArg(args.limit, 1000), 5000);
    const start = Math.max(0, offset - 1);
    const selected = lines.slice(start, start + limit).join("\n");
    const remaining = Math.max(0, lines.length - (start + limit));
    const bounded = boundFileText(selected, { maxLines: limit });
    const messages: string[] = [];
    if (bounded.truncated) {
      messages.push(formatSelectedRangeTruncation(bounded));
    }
    if (remaining > 0) {
      messages.push(
        bounded.truncated
          ? `[...${remaining} more lines remain after the requested range. Narrow this read range before continuing past it.]`
          : `[...${remaining} more lines. Continue with offset ${offset + limit}.]`,
      );
    }
    const output = [bounded.text, ...messages]
      .filter((part) => part.length > 0)
      .join("\n\n");
    const wasTruncated = bounded.truncated || remaining > 0;
    return {
      path,
      content: output,
      contentBlocks: [{ type: "text", text: output }],
      details: wasTruncated
        ? {
            truncation: {
              ...textBoundaryDetails(bounded),
              truncated: true,
              omittedLines: bounded.omittedLines + remaining,
              nextOffset:
                !bounded.truncated && remaining > 0
                  ? offset + limit
                  : undefined,
            },
            outputLimits: {
              execution: {
                ...textLimitSnapshot(bounded),
                truncated: true,
                omittedLines: bounded.omittedLines + remaining,
              },
              continuation:
                !bounded.truncated && remaining > 0
                  ? { nextOffset: offset + limit }
                  : undefined,
            },
          }
        : undefined,
    };
  }

  const bounded = boundFileText(content, { maxLines: DEFAULT_MAX_LINES });
  let output = bounded.text;
  if (bounded.truncated) {
    output += `\n\n[...output truncated to ${DEFAULT_MAX_LINES} lines, ${formatSize(DEFAULT_MAX_BYTES)}, or ${FILE_OUTPUT_MAX_LINE_CHARS} characters per line.${formatContinuationGuidance(bounded)}]`;
  }
  return {
    path,
    content: output,
    contentBlocks: [{ type: "text", text: output }],
    details: bounded.truncated
      ? {
          truncation: textBoundaryDetails(bounded),
          outputLimits: { execution: textLimitSnapshot(bounded) },
        }
      : undefined,
  };
}

function readByteRange(
  path: string,
  buffer: Buffer,
  args: Record<string, unknown>,
): ToolExecutionResult {
  const requestedOffset = Math.min(
    numberArg(args.byteOffset, 0),
    buffer.length,
  );
  const requestedLimit = positiveIntegerArg(
    args.byteLimit,
    READ_BYTE_DEFAULT_LIMIT,
    READ_BYTE_MAX_LIMIT,
  );
  const requestedEnd = Math.min(
    buffer.length,
    requestedOffset + requestedLimit,
  );
  const slice = safeUtf8Slice(buffer, requestedOffset, requestedEnd);
  const bounded = boundText(slice.text, {
    maxBytes: requestedLimit,
    maxLines: Number.MAX_SAFE_INTEGER,
    maxLineChars: requestedLimit,
  });
  const nextByteOffset =
    requestedEnd < buffer.length ? requestedEnd : undefined;
  const messages: string[] = [];
  if (bounded.truncated) {
    messages.push(formatByteRangeTruncation(bounded));
  }
  if (nextByteOffset !== undefined) {
    messages.push(
      `[...${formatSize(buffer.length - requestedEnd)} remain after this byte range. Continue with byteOffset ${nextByteOffset}.]`,
    );
  }
  const output = [bounded.text, ...messages]
    .filter((part) => part.length > 0)
    .join("\n\n");
  return {
    path,
    content: output,
    contentBlocks: [{ type: "text", text: output }],
    details: {
      byteOffset: requestedOffset,
      byteLimit: requestedLimit,
      actualByteOffset: slice.start,
      actualByteEnd: slice.end,
      size: buffer.length,
      nextByteOffset,
      truncation: bounded.truncated ? textBoundaryDetails(bounded) : undefined,
      outputLimits: {
        execution: textLimitSnapshot(bounded),
        continuation:
          nextByteOffset !== undefined ? { nextByteOffset } : undefined,
      },
    },
  };
}

function boundFileText(
  text: string,
  options: { maxLines: number },
): BoundedTextResult {
  return boundText(text, {
    maxLines: options.maxLines,
    maxBytes: DEFAULT_MAX_BYTES,
    maxLineChars: FILE_OUTPUT_MAX_LINE_CHARS,
  });
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split("\n").length;
}

function formatSelectedRangeTruncation(truncation: BoundedTextResult): string {
  const omissions = formatOmissions(truncation);
  const guidance =
    truncation.partialLine || truncation.truncatedLines > 0
      ? " Use byteOffset/byteLimit to inspect overlong lines exactly."
      : "";
  return `[...selected output truncated to ${formatSize(DEFAULT_MAX_BYTES)} or ${FILE_OUTPUT_MAX_LINE_CHARS} characters per line${omissions}.${guidance}]`;
}

function formatByteRangeTruncation(truncation: BoundedTextResult): string {
  const omissions = formatOmissions(truncation);
  return `[...byte range output truncated${omissions}. Use a smaller byteLimit to inspect this range.]`;
}

function formatContinuationGuidance(truncation: BoundedTextResult): string {
  if (truncation.partialLine || truncation.truncatedLines > 0) {
    return " Use byteOffset/byteLimit to inspect overlong lines exactly.";
  }
  return ` Continue reading with offset ${countLines(truncation.text) + 1}.`;
}

function formatOmissions(truncation: BoundedTextResult): string {
  const parts: string[] = [];
  if (truncation.truncatedLines > 0) {
    parts.push(
      `${truncation.truncatedLines} overlong line${truncation.truncatedLines === 1 ? "" : "s"}`,
    );
  }
  if (truncation.omittedLines > 0) {
    parts.push(
      `${truncation.omittedLines} omitted line${truncation.omittedLines === 1 ? "" : "s"}`,
    );
  }
  if (truncation.omittedBytes > 0) {
    parts.push(`${formatSize(truncation.omittedBytes)} omitted`);
  }
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function positiveIntegerArg(
  value: unknown,
  fallback: number,
  max: number,
): number {
  const number = numberArg(value, fallback);
  if (number <= 0) return fallback;
  return Math.min(number, max);
}

function safeUtf8Slice(
  buffer: Buffer,
  start: number,
  end: number,
): { text: string; start: number; end: number } {
  let safeStart = Math.max(0, Math.min(start, buffer.length));
  let safeEnd = Math.max(safeStart, Math.min(end, buffer.length));
  while (
    safeStart < safeEnd &&
    isUtf8ContinuationByte(buffer[safeStart] ?? 0)
  ) {
    safeStart += 1;
  }
  while (
    safeEnd > safeStart &&
    safeEnd < buffer.length &&
    isUtf8ContinuationByte(buffer[safeEnd] ?? 0)
  ) {
    safeEnd -= 1;
  }
  return {
    text: buffer.subarray(safeStart, safeEnd).toString("utf8"),
    start: safeStart,
    end: safeEnd,
  };
}

function isUtf8ContinuationByte(byte: number): boolean {
  return (byte & 0xc0) === 0x80;
}
