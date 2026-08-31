import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  WebExecutionContext,
  ToolExecutionResult,
} from "../execution-context.js";
import { webFetchCandidateFitsInline } from "../../result-projection/candidates/web.js";
import {
  HTML_CONVERSION_MAX_INPUT_BYTES,
  HTML_CONVERSION_TIMEOUT_MS,
  isolatedHtmlToMarkdown,
} from "../atlassian/isolated-html-to-markdown.js";
import { withTimeoutSignal } from "../process/abort.js";
import {
  assertSafeHttpUrl,
  type HostResolver,
} from "../network/network-policy.js";
import { ToolExecutionError } from "../errors/tool-error.js";
import { formatByteSize } from "../output/truncate.js";

const MAX_RESPONSE_BYTES = HTML_CONVERSION_MAX_INPUT_BYTES;
const MAX_REDIRECTS = 5;

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

function formatKindForContent(
  contentType: string,
): "text" | "json" | "image" | "binary" {
  const base = baseContentType(contentType);
  if (base === "application/json") return "json";
  if (
    base.startsWith("text/") ||
    base.includes("xml") ||
    base.includes("javascript")
  )
    return "text";
  if (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(base))
    return "image";
  return "binary";
}

function isHtml(contentType: string): boolean {
  return baseContentType(contentType) === "text/html";
}

function saveDir(context: WebExecutionContext): string {
  return context.artifactDir ?? join(tmpdir(), "nerve-web-fetch");
}

function tmpPath(
  context: WebExecutionContext,
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
  path: string,
  content: Buffer | string,
  contentType: string,
  formatKind: "markdown" | "text" | "json" | "image" | "binary",
  role: "primary_result" | "supporting_data" = "primary_result",
  label = "Fetched content",
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
        id: "fetched_content",
        role,
        path,
        format: {
          kind: formatKind,
          mediaType: contentType,
          ...(["markdown", "text", "json"].includes(formatKind)
            ? { encoding: "utf-8" as const }
            : {}),
        },
        label,
        bytes,
        lines: text ? lineCount(text) : undefined,
        recommendedTools:
          formatKind === "image"
            ? (["read"] as const)
            : ["markdown", "text", "json"].includes(formatKind)
              ? (["read", "grep"] as const)
              : ([] as const),
      },
    ],
  };
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
  context: WebExecutionContext,
  url: string,
  ext: string,
  content: Buffer | string,
): Promise<string> {
  await mkdir(saveDir(context), { recursive: true });
  const path = tmpPath(context, url, ext);
  await writeFile(path, content);
  return path;
}

export async function fetchWithPolicy(
  rawUrl: string,
  signal: AbortSignal,
  allowPrivateNetwork: boolean,
  dependencies: {
    fetch?: typeof fetch;
    resolveHost?: HostResolver;
  } = {},
): Promise<{ response: Response; url: URL }> {
  const fetchImpl = dependencies.fetch ?? fetch;
  const networkPolicy = {
    allowPrivateNetwork,
    resolveHost: dependencies.resolveHost,
  };
  let url = await assertSafeHttpUrl(rawUrl, networkPolicy);
  for (let redirects = 0; ; redirects += 1) {
    const response = await fetchImpl(url, {
      headers: {
        "User-Agent": "nerve/1.0",
        Accept: "text/html,application/json,text/plain,*/*",
      },
      redirect: "manual",
      signal,
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, url };
    }
    if (redirects >= MAX_REDIRECTS) {
      await response.body?.cancel().catch(() => undefined);
      throw new ToolExecutionError(
        "WEB_FETCH_TOO_MANY_REDIRECTS",
        `Fetch exceeded the ${MAX_REDIRECTS} redirect limit.`,
      );
    }
    const location = response.headers.get("location");
    if (!location) return { response, url };
    await response.body?.cancel().catch(() => undefined);
    url = await assertSafeHttpUrl(new URL(location, url), networkPolicy);
  }
}

export async function executeWebFetch(
  args: Record<string, unknown>,
  context: WebExecutionContext,
): Promise<ToolExecutionResult> {
  const requestedUrl = stringArg(args.url, "url");
  const raw = args.raw === true;

  const signal = withTimeoutSignal(context.signal, 60_000);
  const fetched = await fetchWithPolicy(
    requestedUrl,
    signal,
    context.webFetchPolicy?.allowPrivateNetwork === true,
  );
  const { response } = fetched;
  const url = fetched.url.toString();

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
      details.savedTo,
      buffer,
      contentType,
      formatKindForContent(contentType),
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
      details.savedTo,
      buffer,
      contentType,
      formatKindForContent(contentType),
    );
    const content = `Binary content saved to: ${details.savedTo}\nSize: ${formatByteSize(size)}\nContent-Type: ${contentType}\nUse the read tool to inspect it.`;
    return {
      content,
      contentBlocks: [{ type: "text", text: content }],
      details,
    };
  }

  const rawText = buffer.toString("utf8");
  let text = rawText;
  let prettyJson = false;
  if (baseContentType(contentType) === "application/json") {
    try {
      const formatted = JSON.stringify(JSON.parse(rawText) as unknown, null, 2);
      if (formatted !== rawText) {
        text = formatted;
        prettyJson = true;
        details.converted = true;
      }
    } catch {
      // Invalid JSON remains exact text and is handled as ordinary prose.
    }
  }
  if (isHtml(contentType)) {
    text = await isolatedHtmlToMarkdown(text, { signal });
    details.converted = true;
  }

  if (webFetchCandidateFitsInline(details, text)) {
    return {
      content: text,
      contentBlocks: [{ type: "text", text }],
      details,
    };
  }

  const saveExt = details.converted ? ".md" : ext;
  details.savedTo = await saveContent(context, url, saveExt, text);
  const primaryLimits = savedContentLimits(
    details.savedTo,
    text,
    details.converted && !prettyJson ? "text/markdown" : contentType,
    details.converted && !prettyJson
      ? "markdown"
      : formatKindForContent(contentType),
  );
  details.outputLimits = primaryLimits;
  if (prettyJson) {
    const rawPath = await saveContent(context, url, ".raw.json", buffer);
    const rawLimits = savedContentLimits(
      rawPath,
      buffer,
      contentType,
      "json",
      "supporting_data",
      "Exact raw JSON response",
    );
    details.rawSavedTo = rawPath;
    details.outputLimits = {
      ...primaryLimits,
      artifacts: [
        ...(primaryLimits.artifacts ?? []),
        ...(rawLimits.artifacts ?? []),
      ],
    };
  }
  const content = `Response saved to: ${details.savedTo}\nSize: ${formatByteSize(Buffer.byteLength(text))}${details.converted ? " (converted to markdown)" : ""}\nThe content is large — use grep or read to inspect it.`;
  return { content, contentBlocks: [{ type: "text", text: content }], details };
}
