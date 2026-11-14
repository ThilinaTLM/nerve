import type { ArtifactRef, FormPart } from "@nervekit/extension-api";
import { ExtensionError } from "@nervekit/extension-api";
import { MAX_ATTACHMENT_BYTES } from "../shared/files.js";
import {
  rawRequestUrl,
  sendRaw,
  type BinaryNaming,
} from "../shared/raw-request.js";
import { trimTrailingSlashes } from "../shared/site-url.js";
import {
  readJson,
  send,
  sendJson,
  TRANSFER_TIMEOUT_MS,
  bodyText,
  type Connection,
} from "../shared/transport.js";
import type { ResponseParser } from "../shared/http.js";

/** The run's Confluence connection: `ctx` plus the account's site. Credentials never reach it. */
export type ConfluenceConnection = Connection & {
  defaultSpaceKey?: string;
};

export type ConfluenceApiVersion = "v1" | "v2";

type QueryValue = string | number | boolean | string[] | number[] | undefined;

type ConfluenceRequestOptions = {
  api?: ConfluenceApiVersion;
  method?: string;
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  timeoutMs?: number;
};

type Parsed<T> = { parse: ResponseParser<T> };

export function normalizeSiteUrl(value: string): string {
  let siteUrl = trimTrailingSlashes(value.trim());
  if (siteUrl.endsWith("/wiki")) siteUrl = siteUrl.slice(0, -5);
  return trimTrailingSlashes(siteUrl);
}

/**
 * Perform a Confluence request. Pass `parse` to validate the consumed
 * response shape; without it the payload is returned as `unknown`.
 */
export function confluenceRequest<T>(
  connection: ConfluenceConnection,
  options: ConfluenceRequestOptions & Parsed<T>,
): Promise<T>;
export function confluenceRequest(
  connection: ConfluenceConnection,
  options: ConfluenceRequestOptions,
): Promise<unknown>;
export async function confluenceRequest(
  connection: ConfluenceConnection,
  options: ConfluenceRequestOptions & Partial<Parsed<unknown>>,
): Promise<unknown> {
  const apiRoot = options.api === "v1" ? "/wiki/rest/api" : "/wiki/api/v2";
  const url = new URL(`${connection.siteUrl}${apiRoot}${options.path}`);
  appendQuery(url, options.query);
  return await sendJson(connection, {
    service: "confluence",
    url,
    method: options.method,
    body: options.body,
    errorPath: options.path,
    errorReason: (text) => confluenceErrorReason(text, options.body),
    timeoutMs: options.timeoutMs,
    parse: options.parse,
  });
}

/** REST bases `confluence.request()` may call (v2 and v1). */
export const CONFLUENCE_RAW_BASES = [
  "/wiki/api/v2/",
  "/wiki/rest/api/",
] as const;

/** Raw request for `confluence.request()`: any path under the allowed bases, JSON or text back. */
export async function confluenceRawRequest(
  connection: ConfluenceConnection,
  options: {
    method: string;
    path: unknown;
    body?: unknown;
    query?: unknown;
    /** Saves a binary response as an artifact. */
    binary?: BinaryNaming;
  },
): Promise<unknown> {
  const url = rawRequestUrl(
    connection.siteUrl,
    options.path,
    CONFLUENCE_RAW_BASES,
    options.query,
  );
  return await sendRaw(connection, {
    service: "confluence",
    url,
    method: options.method,
    body: options.body,
    binary: options.binary,
  });
}

/** Uploads a file to a page (`PUT` replaces a same-name attachment, `POST` adds one). */
export async function confluenceAttachmentRequest<T>(
  connection: ConfluenceConnection,
  options: {
    method: "POST" | "PUT";
    pageId: string;
    parts: readonly FormPart[];
    query?: Record<string, QueryValue>;
  } & Parsed<T>,
): Promise<T> {
  const path = `/content/${pathSegment(options.pageId)}/child/attachment`;
  const url = new URL(`${connection.siteUrl}/wiki/rest/api${path}`);
  appendQuery(url, options.query);
  const response = await send(connection, {
    service: "confluence",
    url,
    method: options.method,
    headers: { "X-Atlassian-Token": "nocheck" },
    body: { form: options.parts },
    timeoutMs: TRANSFER_TIMEOUT_MS,
    errorPath: path,
  });
  return readJson(
    response,
    { service: "confluence", method: options.method, path },
    options.parse,
  );
}

const DIRECT_DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Downloads an attachment. Only the first request, to the configured site,
 * carries the credential; Cloud answers with a redirect to a signed media URL
 * (api.media.atlassian.com), which the host follows without it.
 */
async function sendDownload(
  connection: ConfluenceConnection,
  downloadLink: string,
  response: "bytes" | { artifact: string },
  maxBytes: number,
) {
  const url = resolveConfluenceDownloadUrl(connection, downloadLink);
  return await send(connection, {
    service: "confluence",
    url,
    headers: { Accept: "*/*" },
    response,
    timeoutMs: TRANSFER_TIMEOUT_MS,
    maxBytes,
    errorPath: url.pathname,
  });
}

export async function confluenceDownload(
  connection: ConfluenceConnection,
  downloadLink: string,
): Promise<Uint8Array> {
  const response = await sendDownload(
    connection,
    downloadLink,
    "bytes",
    DIRECT_DOWNLOAD_MAX_BYTES,
  );
  return response.body instanceof Uint8Array
    ? response.body
    : new TextEncoder().encode(bodyText(response));
}

/** Streams an attachment into the artifact `name` (up to the attachment limit). */
export async function confluenceDownloadToArtifact(
  connection: ConfluenceConnection,
  downloadLink: string,
  options: { name: string; maxBytes?: number },
): Promise<ArtifactRef> {
  const response = await sendDownload(
    connection,
    downloadLink,
    { artifact: options.name },
    options.maxBytes ?? MAX_ATTACHMENT_BYTES,
  );
  return response.body as ArtifactRef;
}

function resolveConfluenceDownloadUrl(
  connection: ConfluenceConnection,
  downloadLink: string,
): URL {
  const trimmed = downloadLink.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    const absoluteUrl = new URL(trimmed);
    const configuredOrigin = new URL(connection.siteUrl).origin;
    if (absoluteUrl.origin !== configuredOrigin) {
      throw new ExtensionError(
        "DENIED",
        "Confluence attachment download URL is outside the configured site.",
      );
    }
    return absoluteUrl;
  }

  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const wikiPath =
    path === "/wiki" || path.startsWith("/wiki/") ? path : `/wiki${path}`;
  return new URL(`${connection.siteUrl}${wikiPath}`);
}

function appendQuery(url: URL, query: Record<string, QueryValue> | undefined) {
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}

/**
 * Replaces Confluence's JSON error documents (v2 `{ errors: [{ title, detail }] }`,
 * v1 `{ message, data.errors[].message.translation }`) with one readable sentence;
 * other bodies pass through. A duplicate page title names the title.
 */
export function confluenceErrorReason(body: string, requestBody?: unknown) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (!parsed || typeof parsed !== "object") return body;
  const record = parsed as Record<string, unknown>;
  const parts: string[] = [];
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? [value.trim()] : [];
  if (Array.isArray(record.errors)) {
    for (const item of record.errors) {
      const entry = (item ?? {}) as Record<string, unknown>;
      parts.push(...text(entry.detail ?? entry.title));
    }
  }
  const data = record.data as { errors?: unknown } | undefined;
  if (Array.isArray(data?.errors)) {
    for (const item of data.errors) {
      const message = (item as { message?: unknown } | null)?.message;
      parts.push(
        ...text(
          typeof message === "object" && message
            ? ((message as Record<string, unknown>).translation ??
                (message as Record<string, unknown>).key)
            : message,
        ),
      );
    }
  }
  if (parts.length === 0) parts.push(...text(record.message));
  if (parts.length === 0) return body;
  const reason = [...new Set(parts)].join("; ");
  const title = (requestBody as { title?: unknown } | null | undefined)?.title;
  if (typeof title === "string" && /already exists|same title/i.test(reason)) {
    return `A page titled "${title}" already exists in this space (titles are unique per space); pick another title or update that page`;
  }
  return reason;
}

export function pathSegment(value: string): string {
  return encodeURIComponent(value);
}
