import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeHtmlMarkdown } from "node-html-markdown";
import type { ToolExecutionContext, ToolExecutionResult } from "../types.js";

const MAX_INLINE_BYTES = 512 * 1024;

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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function timeoutSignal(
  signal: AbortSignal | undefined,
  milliseconds: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(milliseconds);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
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

  const response = await fetch(url, {
    headers: {
      "User-Agent": "nerve/1.0",
      Accept: "text/html,application/json,text/plain,*/*",
    },
    redirect: "follow",
    signal: timeoutSignal(context.signal, 60_000),
  });

  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }

  const contentType =
    response.headers.get("content-type") ?? "application/octet-stream";
  const buffer = Buffer.from(await response.arrayBuffer());
  const size = buffer.byteLength;
  const ext = getExtension(contentType);
  const details = {
    url,
    status: response.status,
    contentType,
    size,
    converted: false,
    savedTo: undefined as string | undefined,
  };

  if (raw) {
    details.savedTo = await saveContent(context, url, ext, buffer);
    const content = `Raw content saved to: ${details.savedTo}\nSize: ${formatSize(size)}\nContent-Type: ${contentType}`;
    return {
      content,
      contentBlocks: [{ type: "text", text: content }],
      details,
    };
  }

  if (!isTextType(contentType)) {
    details.savedTo = await saveContent(context, url, ext, buffer);
    const content = `Binary content saved to: ${details.savedTo}\nSize: ${formatSize(size)}\nContent-Type: ${contentType}\nUse the read tool to inspect it.`;
    return {
      content,
      contentBlocks: [{ type: "text", text: content }],
      details,
    };
  }

  let text = buffer.toString("utf8");
  if (isHtml(contentType)) {
    text = NodeHtmlMarkdown.translate(text);
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
  const content = `Response saved to: ${details.savedTo}\nSize: ${formatSize(Buffer.byteLength(text))}${details.converted ? " (converted to markdown)" : ""}\nThe content is large — use grep or read to inspect it.`;
  return { content, contentBlocks: [{ type: "text", text: content }], details };
}
