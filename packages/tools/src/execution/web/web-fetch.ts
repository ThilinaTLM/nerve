import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import {
  HTML_CONVERSION_MAX_INPUT_BYTES,
  HTML_CONVERSION_TIMEOUT_MS,
  isolatedHtmlToMarkdown,
} from "../common/isolated-html-to-markdown.js";
import { ToolExecutionError } from "../common/tool-error.js";
import { formatByteSize } from "../common/truncate.js";

const MAX_INLINE_BYTES = 512 * 1024;
const MAX_RESPONSE_BYTES = HTML_CONVERSION_MAX_INPUT_BYTES;

const CONTENT_TYPE_EXT: Record<string, string> = {
  "text/html": ".html",
  "text/plain": ".txt",
  "text/xml": ".xml",
  "text/css": ".css",
  "text/csv": ".csv",
  "application/json": ".json",
  "application/xml": ".xml",
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
};

function stringArg(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function baseContentType(contentType: string): string {
  return contentType.split(";")[0]?.trim().toLowerCase() || "";
}

function getExtension(contentType: string): string {
  return CONTENT_TYPE_EXT[baseContentType(contentType)] ?? ".bin";
}

function isTextType(contentType: string): boolean {
  const base = baseContentType(contentType);
  return (
    base.startsWith("text/") ||
    base === "application/json" ||
    base === "application/xml" ||
    base === "application/javascript"
  );
}

function isHtml(contentType: string): boolean {
  return baseContentType(contentType) === "text/html";
}

function saveDir(context: ToolExecutionContext): string {
  return context.dataDir
    ? join(context.dataDir, "tmp", "web-fetch")
    : join(tmpdir(), "nerve-web-fetch");
}

function tmpPath(
  context: ToolExecutionContext,
  url: string,
  ext: string,
): string {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 12);
  return join(saveDir(context), `${hash}${ext}`);
}

function lineCount(text: string): number {
  if (text.length === 0) return 0;
  return text.split(/\r?\n/).length;
}

function savedContentLimits(
  kind: "fetched_content",
  path: string,
  content: Buffer | string,
) {
  const text = typeof content === "string" ? content : undefined;
  const bytes =
    typeof content === "string"
      ? Buffer.byteLength(content, "utf8")
      : content.byteLength;
  return {
    execution: {
      truncated: true,
      direction: "head" as const,
      originalBytes: bytes,
      displayedBytes: 0,
      omittedBytes: bytes,
      originalChars: text?.length,
      displayedChars: 0,
      omittedChars: text?.length,
      originalLines: text ? lineCount(text) : undefined,
      displayedLines: 0,
      omittedLines: text ? lineCount(text) : undefined,
    },
    artifacts: [
      {
        kind,
        path,
        label: "Fetched content",
        bytes,
        chars: text?.length,
        lines: text ? lineCount(text) : undefined,
      },
    ],
  };
}

function timeoutSignal(
  signal: AbortSignal | undefined,
  milliseconds: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(milliseconds);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function readBoundedResponse(
  response: Response,
  signal: AbortSignal,
): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new ToolExecutionError(
      "WEB_FETCH_RESPONSE_TOO_LARGE",
      `Response exceeds the ${formatByteSize(MAX_RESPONSE_BYTES)} download limit.`,
    );
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const onAbort = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new ToolExecutionError(
          "WEB_FETCH_RESPONSE_TOO_LARGE",
          `Response exceeds the ${formatByteSize(MAX_RESPONSE_BYTES)} download limit.`,
        );
      }
      chunks.push(value);
    }
    if (signal.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new Error("Web fetch was aborted.");
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  return Buffer.concat(chunks, size);
}

async function saveContent(
  context: ToolExecutionContext,
  url: string,
  ext: string,
  content: Buffer | string,
): Promise<string> {
  await mkdir(saveDir(context), { recursive: true });
  const path = tmpPath(context, url, ext);
  await writeFile(path, content);
  return path;
}

export async function executeWebFetch(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const url = stringArg(args.url, "url");
  const raw = args.raw === true;

  const signal = timeoutSignal(context.signal, 60_000);
  const response = await fetch(url, {
    headers: {
      "User-Agent": "nerve/1.0",
      Accept: "text/html,application/json,text/plain,*/*",
    },
    redirect: "follow",
    signal,
  });

  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }

  const contentType =
    response.headers.get("content-type") ?? "application/octet-stream";
  const buffer = await readBoundedResponse(response, signal);
  const size = buffer.byteLength;
  const ext = getExtension(contentType);
  const details: Record<string, unknown> & {
    url: string;
    status: number;
    contentType: string;
    size: number;
    converted: boolean;
    savedTo?: string;
  } = {
    url,
    status: response.status,
    contentType,
    size,
    converted: false,
    savedTo: undefined,
    limits: {
      maxResponseBytes: MAX_RESPONSE_BYTES,
      htmlConversionTimeoutMs: HTML_CONVERSION_TIMEOUT_MS,
    },
  };

  if (raw) {
    details.savedTo = await saveContent(context, url, ext, buffer);
    details.outputLimits = savedContentLimits(
      "fetched_content",
      details.savedTo,
      buffer,
    );
    const content = `Raw content saved to: ${details.savedTo}\nSize: ${formatByteSize(size)}\nContent-Type: ${contentType}`;
    return {
      content,
      contentBlocks: [{ type: "text", text: content }],
      details,
    };
  }

  if (!isTextType(contentType)) {
    details.savedTo = await saveContent(context, url, ext, buffer);
    details.outputLimits = savedContentLimits(
      "fetched_content",
      details.savedTo,
      buffer,
    );
    const content = `Binary content saved to: ${details.savedTo}\nSize: ${formatByteSize(size)}\nContent-Type: ${contentType}\nUse the read tool to inspect it.`;
    return {
      content,
      contentBlocks: [{ type: "text", text: content }],
      details,
    };
  }

  let text = buffer.toString("utf8");
  if (isHtml(contentType)) {
    text = await isolatedHtmlToMarkdown(text, { signal });
    details.converted = true;
  }

  if (Buffer.byteLength(text) <= MAX_INLINE_BYTES) {
    return {
      content: text,
      contentBlocks: [{ type: "text", text }],
      details,
    };
  }

  const saveExt = details.converted ? ".md" : ext;
  details.savedTo = await saveContent(context, url, saveExt, text);
  details.outputLimits = savedContentLimits(
    "fetched_content",
    details.savedTo,
    text,
  );
  const content = `Response saved to: ${details.savedTo}\nSize: ${formatByteSize(Buffer.byteLength(text))}${details.converted ? " (converted to markdown)" : ""}\nThe content is large — use grep or read to inspect it.`;
  return { content, contentBlocks: [{ type: "text", text: content }], details };
}
