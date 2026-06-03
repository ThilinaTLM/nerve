import { readFile } from "node:fs/promises";
import type { ToolExecutionContext, ToolExecutionResult } from "../types.js";
import { numberArg } from "./common.js";
import { resolveReadPath } from "./path.js";
import { DEFAULT_MAX_LINES, formatSize, truncateHead } from "./truncate.js";

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
  const buffer = await readFile(path);
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
    const output =
      remaining > 0
        ? `${selected}\n\n[...${remaining} more lines. Continue with offset ${offset + limit}.]`
        : selected;
    return {
      path,
      content: output,
      contentBlocks: [{ type: "text", text: output }],
      details:
        remaining > 0
          ? { truncation: { omittedLines: remaining, nextOffset: offset + limit } }
          : undefined,
    };
  }

  const truncated = truncateHead(content);
  let output = truncated.text;
  if (truncated.truncated) {
    output += `\n\n[...output truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(50 * 1024)}. Continue reading with offset ${countLines(truncated.text) + 1}.]`;
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
