import { readFile } from "node:fs/promises";
import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { numberArg } from "../common/args.js";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationResult,
  truncateHead,
} from "../common/truncate.js";
import {
  isErrnoException,
  pathNotFoundMessage,
  resolveReadPath,
} from "./path.js";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

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
  const mimeType = detectSupportedImageMimeType(buffer);

  if (mimeType) {
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

  const content = buffer.toString("utf8");
  const lines = content.split(/\r?\n/);
  const hasExplicitLimit = typeof args.limit === "number";
  const hasExplicitOffset = typeof args.offset === "number";
  const offset = numberArg(args.offset, 1);

  if (hasExplicitLimit || hasExplicitOffset) {
    const limit = Math.min(numberArg(args.limit, 1000), 5000);
    const start = Math.max(0, offset - 1);
    const selected = lines.slice(start, start + limit).join("\n");
    const remaining = Math.max(0, lines.length - (start + limit));
    const truncated = truncateHead(selected, {
      maxLines: limit,
      maxBytes: DEFAULT_MAX_BYTES,
    });
    const messages: string[] = [];
    if (truncated.truncated) {
      messages.push(formatSelectedRangeTruncation(truncated));
    }
    if (remaining > 0) {
      messages.push(
        truncated.truncated
          ? `[...${remaining} more lines remain after the requested range. Narrow this read range before continuing past it.]`
          : `[...${remaining} more lines. Continue with offset ${offset + limit}.]`,
      );
    }
    const output = [truncated.text, ...messages]
      .filter((part) => part.length > 0)
      .join("\n\n");
    const wasTruncated = truncated.truncated || remaining > 0;
    return {
      path,
      content: output,
      contentBlocks: [{ type: "text", text: output }],
      details: wasTruncated
        ? {
            truncation: {
              ...truncated,
              truncated: true,
              omittedLines: truncated.omittedLines + remaining,
              nextOffset:
                !truncated.truncated && remaining > 0
                  ? offset + limit
                  : undefined,
            },
          }
        : undefined,
    };
  }

  const truncated = truncateHead(content);
  let output = truncated.text;
  if (truncated.truncated) {
    output += `\n\n[...output truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.${formatContinuationGuidance(truncated)}]`;
  }
  return {
    path,
    content: output,
    contentBlocks: [{ type: "text", text: output }],
    details: truncated.truncated ? { truncation: truncated } : undefined,
  };
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split("\n").length;
}

function formatSelectedRangeTruncation(truncation: TruncationResult): string {
  const omissions = formatOmissions(truncation);
  const guidance = truncation.partialLine
    ? " The output ended within an overlong line; line offsets cannot continue within that line."
    : "";
  return `[...selected output truncated to ${formatSize(DEFAULT_MAX_BYTES)}${omissions}.${guidance}]`;
}

function formatContinuationGuidance(truncation: TruncationResult): string {
  if (truncation.partialLine) {
    return " The output ended within an overlong line; line offsets cannot continue within that line.";
  }
  return ` Continue reading with offset ${countLines(truncation.text) + 1}.`;
}

function formatOmissions(truncation: TruncationResult): string {
  const parts: string[] = [];
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
