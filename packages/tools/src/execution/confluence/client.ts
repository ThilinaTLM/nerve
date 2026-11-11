import { guideErrorMessage } from "./guide-errors.js";
import { trimTrailingSlashes } from "../atlassian/site-url.js";
import type { IntegrationExecutionContext } from "../execution-context.js";
import { withTimeoutSignal } from "../process/abort.js";
import { safeAtlassianError } from "../atlassian/atlassian-error.js";
import { ToolExecutionError } from "../errors/tool-error.js";
import {
  type BinaryHandler,
  rawRequestUrl,
  readRawBody,
} from "../atlassian/raw-request.js";
import {
  BodyTooLargeError,
  idleTimeoutSignal,
  streamBodyToFile,
} from "../atlassian/stream-download.js";
import {
  anyJson,
  atlassianJsonRequestInit,
  basicAuthHeader,
  readAtlassianJson,
  type ResponseParser,
} from "../atlassian/http.js";

export type ConfluenceConnection = {
  siteUrl: string;
  email: string;
  token: string;
  defaultSpaceKey?: string;
};

type ConfluenceConfig = {
  enabled?: unknown;
  siteUrl?: unknown;
  email?: unknown;
  defaultSpaceKey?: unknown;
};

export type ConfluenceApiVersion = "v1" | "v2";

type QueryValue = string | number | boolean | string[] | number[] | undefined;

type ConfluenceRequestOptions = {
  api?: ConfluenceApiVersion;
  method?: string;
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  signal?: AbortSignal;
};

type Parsed<T> = { parse: ResponseParser<T> };

type MultipartAttachmentOptions = {
  method: "POST" | "PUT";
  pageId: string;
  form: FormData;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
};

export async function requireConfluenceConnection(
  context: IntegrationExecutionContext,
): Promise<ConfluenceConnection> {
  const token = await context.getApiKey?.("confluence");
  const rawConfig = (await context.getProviderConfig?.("confluence")) as
    | ConfluenceConfig
    | undefined;
  const siteUrl = normalizeSiteUrl(
    typeof rawConfig?.siteUrl === "string" ? rawConfig.siteUrl : "",
  );
  const email =
    typeof rawConfig?.email === "string" ? rawConfig.email.trim() : "";
  const defaultSpaceKey =
    typeof rawConfig?.defaultSpaceKey === "string" &&
    rawConfig.defaultSpaceKey.trim().length > 0
      ? rawConfig.defaultSpaceKey.trim()
      : undefined;

  if (rawConfig?.enabled !== true || !siteUrl || !email || !token) {
    throw new ToolExecutionError(
      "CONFLUENCE_NOT_CONFIGURED",
      "Confluence is not configured or enabled. Configure Confluence site URL, Atlassian email, and API token in Nerve Settings, then enable the Confluence module.",
      {
        enabled: rawConfig?.enabled === true,
        hasSiteUrl: Boolean(siteUrl),
        hasEmail: Boolean(email),
        hasToken: Boolean(token),
      },
    );
  }
  return { siteUrl, email, token, defaultSpaceKey };
}

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

  const init = atlassianJsonRequestInit(basicAuth(connection), options);

  const response = await send(url, init);
  if (!response.ok) {
    await throwConfluenceError(
      response,
      init.method ?? "GET",
      options.path,
      options.body,
    );
  }
  return readAtlassianJson(
    response,
    { service: "confluence", method: init.method ?? "GET", path: options.path },
    options.parse ?? anyJson,
  );
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
    onBinary?: BinaryHandler;
    signal?: AbortSignal;
  },
): Promise<unknown> {
  const url = rawRequestUrl(
    connection.siteUrl,
    options.path,
    CONFLUENCE_RAW_BASES,
    options.query,
  );
  const init = atlassianJsonRequestInit(basicAuth(connection), options);
  const response = await send(url, init);
  if (!response.ok)
    await throwConfluenceError(response, options.method, url.pathname);
  return await readRawBody(response, options.onBinary);
}

export async function confluenceAttachmentRequest<T>(
  connection: ConfluenceConnection,
  options: MultipartAttachmentOptions & Parsed<T>,
): Promise<T> {
  const url = new URL(
    `${connection.siteUrl}/wiki/rest/api/content/${pathSegment(options.pageId)}/child/attachment`,
  );
  appendQuery(url, options.query);
  const response = await send(url, {
    method: options.method,
    headers: {
      Accept: "application/json",
      Authorization: basicAuth(connection),
      "X-Atlassian-Token": "nocheck",
    },
    body: options.form,
    signal: withTimeoutSignal(options.signal, UPLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    await throwConfluenceError(
      response,
      options.method,
      `/content/${pathSegment(options.pageId)}/child/attachment`,
    );
  }
  return readAtlassianJson(
    response,
    {
      service: "confluence",
      method: options.method,
      path: `/content/${pathSegment(options.pageId)}/child/attachment`,
    },
    options.parse,
  );
}

/** Uploads of up to 100 MB need longer than a JSON request. */
const UPLOAD_TIMEOUT_MS = 10 * 60_000;
const DIRECT_DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024;
/** Signed media-host redirects followed after the authenticated first hop. */
const MAX_MEDIA_REDIRECTS = 3;

function attachmentTooLarge(maximum: number, bytes: number) {
  return new ToolExecutionError(
    "CONFLUENCE_ATTACHMENT_TOO_LARGE",
    guideErrorMessage(
      `Confluence attachment exceeds the ${maximum / 1048576} MiB download limit.`,
    ),
    { bytes, maximum },
  );
}

/**
 * Starts an attachment download. Only the first request, to the configured
 * site, carries credentials. Cloud answers with a redirect to a signed media
 * URL (e.g. api.media.atlassian.com); each further hop must be https and is
 * fetched without the Authorization header, so the token never leaves the site.
 */
async function openConfluenceDownload(
  connection: ConfluenceConnection,
  downloadLink: string,
  signal: AbortSignal,
): Promise<{ response: Response; url: URL }> {
  const url = resolveConfluenceDownloadUrl(connection, downloadLink);
  let response = await fetch(url, {
    headers: { Authorization: basicAuth(connection) },
    redirect: "manual",
    signal,
  });
  for (
    let hops = 0;
    response.status >= 300 && response.status < 400;
    hops += 1
  ) {
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    const target = location ? new URL(location, url) : undefined;
    if (target?.protocol !== "https:" || hops >= MAX_MEDIA_REDIRECTS) {
      throw new ToolExecutionError(
        "CONFLUENCE_UNTRUSTED_REDIRECT",
        hops >= MAX_MEDIA_REDIRECTS
          ? "Confluence attachment download redirected too many times."
          : "Confluence attachment download redirected to a non-https location.",
        { status: response.status, location },
      );
    }
    response = await fetch(target, { redirect: "manual", signal });
  }
  if (!response.ok) {
    await throwConfluenceError(response, "GET", url.pathname);
  }
  return { response, url };
}

export async function confluenceDownload(
  connection: ConfluenceConnection,
  downloadLink: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const maximum = DIRECT_DOWNLOAD_MAX_BYTES;
  const { response } = await openConfluenceDownload(
    connection,
    downloadLink,
    withTimeoutSignal(signal, 60_000),
  );
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maximum) throw attachmentTooLarge(maximum, declared);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximum) {
    throw attachmentTooLarge(maximum, bytes.byteLength);
  }
  return bytes;
}

/**
 * Streams an attachment to `destination` (removed on failure or abort) with
 * the limit enforced on Content-Length and on the bytes received.
 */
export async function confluenceDownloadToFile(
  connection: ConfluenceConnection,
  downloadLink: string,
  options: { destination: string; maxBytes: number; signal?: AbortSignal },
): Promise<number> {
  const idle = idleTimeoutSignal(options.signal, 60_000);
  try {
    const { response } = await openConfluenceDownload(
      connection,
      downloadLink,
      idle.signal,
    );
    return await streamBodyToFile(response, options.destination, {
      maxBytes: options.maxBytes,
      signal: idle.signal,
      onChunk: idle.touch,
    }).catch((error: unknown) => {
      throw error instanceof BodyTooLargeError
        ? attachmentTooLarge(options.maxBytes, error.bytes)
        : error;
    });
  } finally {
    idle.dispose();
  }
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
      throw new ToolExecutionError(
        "CONFLUENCE_UNTRUSTED_DOWNLOAD_URL",
        "Confluence attachment download URL is outside the configured site.",
        { configuredOrigin, downloadOrigin: absoluteUrl.origin },
      );
    }
    return absoluteUrl;
  }

  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const wikiPath =
    path === "/wiki" || path.startsWith("/wiki/") ? path : `/wiki${path}`;
  return new URL(`${connection.siteUrl}${wikiPath}`);
}

/** Fetches with credentials; a redirect is an error, so the token never follows one to another host. */
async function send(url: URL, init: RequestInit): Promise<Response> {
  const response = await fetch(url, { ...init, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    throw new ToolExecutionError(
      "CONFLUENCE_UNTRUSTED_REDIRECT",
      `Confluence responded to ${url.pathname} with a redirect; credentialed requests do not follow redirects.`,
      { status: response.status, location: response.headers.get("location") },
    );
  }
  return response;
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

function basicAuth(connection: ConfluenceConnection): string {
  return basicAuthHeader(connection.email, connection.token);
}

async function throwConfluenceError(
  response: Response,
  method: string,
  path: string,
  requestBody?: unknown,
): Promise<never> {
  const body = confluenceErrorReason(
    await response.text().catch(() => ""),
    requestBody,
  );
  const code = confluenceErrorCode(response.status);
  const retryable = response.status === 429 || response.status >= 500;
  const error = safeAtlassianError({
    service: "confluence",
    code,
    method,
    path,
    status: response.status,
    statusText: response.statusText,
    body,
  });
  const message =
    response.status === 400 ? guideErrorMessage(error.message) : error.message;
  throw new ToolExecutionError(code, message, error.details, retryable);
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

function confluenceErrorCode(status: number): string {
  if (status === 400) return "CONFLUENCE_BAD_REQUEST";
  if (status === 401) return "CONFLUENCE_UNAUTHORIZED";
  if (status === 403) return "CONFLUENCE_FORBIDDEN";
  if (status === 404) return "CONFLUENCE_NOT_FOUND";
  if (status === 409) return "CONFLUENCE_CONFLICT";
  if (status === 429) return "CONFLUENCE_RATE_LIMITED";
  if (status >= 500) return "CONFLUENCE_SERVER_ERROR";
  return "CONFLUENCE_API_ERROR";
}

export function pathSegment(value: string): string {
  return encodeURIComponent(value);
}
