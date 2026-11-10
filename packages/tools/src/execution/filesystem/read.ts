import { readFile } from "node:fs/promises";
import type {
  FilesystemExecutionContext,
  ToolExecutionResult,
} from "../execution-context.js";
import { numberArg } from "../process/arguments.js";
import {
  type BoundedTextResult,
  boundText,
  FILE_OUTPUT_MAX_LINE_CHARS,
  textBoundaryDetails,
  textLimitSnapshot,
} from "../output/output-budget.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "../output/truncate.js";
import {
  isErrnoException,
  pathNotFoundMessage,
  resolveReadPath,
} from "./path.js";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const READ_BYTE_DEFAULT_LIMIT = FILE_OUTPUT_MAX_LINE_CHARS;
const READ_BYTE_MAX_LIMIT = FILE_OUTPUT_MAX_LINE_CHARS;
const READ_LINE_MAX_LIMIT = 5000;

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

export function detectSupportedImageMimeType(
  buffer: Uint8Array,
): string | null {
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
  context: FilesystemExecutionContext,
): Promise<ToolExecutionResult> {
  const path = await resolveReadPath(context.cwd, args.path);
  const buffer = await readFile(path).catch(async (error: unknown) => {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new Error(await pathNotFoundMessage(args.path, path, true));
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
  const sourceEndsWithNewline = /(?:\r?\n)$/.test(content);
  const lines = content.length === 0 ? [] : content.split(/\r?\n/);
  if (sourceEndsWithNewline) lines.pop();
  const sourceTotalLines = lines.length;
  const offset = numberArg(args.offset, 1);
  const requestedLimit = numberArg(args.limit, DEFAULT_MAX_LINES);
  const limit = Math.min(requestedLimit, READ_LINE_MAX_LIMIT);
  const start = Math.max(0, offset - 1);
  const selectedLines = lines.slice(start, start + limit);
  const remaining = Math.max(0, lines.length - (start + limit));
  const bounded = boundFileText(selectedLines.join("\n"), { maxLines: limit });
  const byteCut = bounded.omittedLines > 0 || bounded.partialLine === true;
  const returnedContentLines = byteCut
    ? countLines(bounded.text)
    : selectedLines.length;
  // The line after the last complete one; a cut line is read again from its start.
  const nextLine = bounded.partialLine
    ? offset + returnedContentLines - 1
    : offset + returnedContentLines;
  const hasMore = nextLine <= sourceTotalLines;
  const limitClamped =
    hasExplicitLimit && requestedLimit > READ_LINE_MAX_LIMIT && remaining > 0;
  const toolCut =
    byteCut || (remaining > 0 && (!hasExplicitLimit || limitClamped));
  const longLine =
    bounded.truncatedLines > 0
      ? firstLongLine(
          content,
          selectedLines.slice(0, returnedContentLines),
          start,
        )
      : undefined;
  const whole = offset === 1 && !hasMore;
  const trailer = [
    whole
      ? undefined
      : returnedContentLines === 0
        ? `No lines at offset ${offset}; file has ${sourceTotalLines}.`
        : [
            `Lines ${offset}-${offset + returnedContentLines - 1} of ${sourceTotalLines}`,
            limitClamped
              ? `limit clamped to ${READ_LINE_MAX_LIMIT}`
              : undefined,
            toolCut && hasMore
              ? `Next: ${JSON.stringify({ offset: nextLine })}`
              : undefined,
          ]
            .filter((part) => part !== undefined)
            .join(". "),
    longLine
      ? `Line ${longLine.line} cut at ${FILE_OUTPUT_MAX_LINE_CHARS} chars. Rest: ${JSON.stringify({ byteOffset: longLine.byteOffset })}`
      : undefined,
  ].filter((part) => part !== undefined);
  const output = [bounded.text, ...trailer]
    .filter((part) => part.length > 0)
    .join("\n\n");
  const wasTruncated = bounded.truncated || remaining > 0;
  const safeNextOffset = hasMore ? nextLine : undefined;
  return {
    path,
    content: output,
    contentBlocks: [{ type: "text", text: output }],
    details: {
      range: {
        mode: "lines",
        requestedStartLine: offset,
        requestedLimit: limit,
        sourceTotalLines,
        returnedStartLine: offset,
        returnedEndLine:
          returnedContentLines > 0
            ? offset + returnedContentLines - 1
            : offset - 1,
        returnedContentLines,
        sourceEndsWithNewline,
        nextOffset: safeNextOffset,
      },
      ...(wasTruncated
        ? {
            truncation: {
              ...textBoundaryDetails(bounded),
              truncated: true,
              omittedLines: bounded.omittedLines + remaining,
              nextOffset: safeNextOffset,
            },
            outputLimits: {
              execution: {
                ...textLimitSnapshot(bounded),
                truncated: true,
                omittedLines: bounded.omittedLines + remaining,
              },
              continuation:
                safeNextOffset !== undefined
                  ? { nextOffset: safeNextOffset }
                  : undefined,
            },
          }
        : {}),
    },
  };
}

/** The first shortened line in the window, with the byte offset where its cut-off remainder starts. */
function firstLongLine(
  content: string,
  shown: readonly string[],
  startIndex: number,
): { line: number; byteOffset: number } | undefined {
  const index = shown.findIndex(
    (line) => line.length > FILE_OUTPUT_MAX_LINE_CHARS,
  );
  if (index < 0) return undefined;
  let position = 0;
  for (let skipped = 0; skipped < startIndex + index; skipped += 1) {
    position = content.indexOf("\n", position) + 1;
  }
  const kept = shown[index].slice(0, FILE_OUTPUT_MAX_LINE_CHARS);
  return {
    line: startIndex + index + 1,
    byteOffset:
      Buffer.byteLength(content.slice(0, position)) + Buffer.byteLength(kept),
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
  const modelLimit = numberArg(args.byteLimit, 0);
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
  const nextByteOffset = slice.end < buffer.length ? slice.end : undefined;
  const limitClamped =
    modelLimit > READ_BYTE_MAX_LIMIT && nextByteOffset !== undefined;
  // Only a cut the tool imposed (default or capped limit) gets a Next hint.
  const toolCut = modelLimit <= 0 || limitClamped;
  const trailer =
    slice.end === slice.start
      ? buffer.length > 0
        ? `No bytes at byteOffset ${requestedOffset}; file has ${buffer.length}.`
        : undefined
      : slice.start === 0 && nextByteOffset === undefined
        ? undefined
        : [
            `Bytes ${slice.start}-${slice.end - 1} of ${buffer.length}`,
            limitClamped
              ? `byteLimit clamped to ${READ_BYTE_MAX_LIMIT}`
              : undefined,
            toolCut && nextByteOffset !== undefined
              ? `Next: ${JSON.stringify({ byteOffset: nextByteOffset })}`
              : undefined,
          ]
            .filter((part) => part !== undefined)
            .join(". ");
  const output = [bounded.text, trailer]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join("\n\n");
  return {
    path,
    content: output,
    contentBlocks: [{ type: "text", text: output }],
    details: {
      byteOffset: requestedOffset,
      range: {
        mode: "bytes",
        requestedByteOffset: requestedOffset,
        requestedByteLimit: requestedLimit,
        sourceBytes: buffer.length,
        returnedByteStart: requestedOffset,
        returnedByteEnd: requestedEnd,
        utf8AdjustedStart: slice.start,
        utf8AdjustedEnd: slice.end,
        nextByteOffset,
      },
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
