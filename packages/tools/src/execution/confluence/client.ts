import { guideErrorMessage } from "./guide-errors.js";
import { trimTrailingSlashes } from "../atlassian/site-url.js";
import type { IntegrationExecutionContext } from "../execution-context.js";
import { withTimeoutSignal } from "../process/abort.js";
import { safeAtlassianError } from "../atlassian/atlassian-error.js";
import { ToolExecutionError } from "../errors/tool-error.js";
import { rawRequestUrl, readRawBody } from "../atlassian/raw-request.js";
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
    await throwConfluenceError(response, init.method ?? "GET", options.path);
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
    onBinary?: (bytes: Buffer, contentType: string) => Promise<unknown>;
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
    signal: withTimeoutSignal(options.signal, 60_000),
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

export async function confluenceDownload(
  connection: ConfluenceConnection,
  downloadLink: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const url = resolveConfluenceDownloadUrl(connection, downloadLink);
  const timeout = withTimeoutSignal(signal, 60_000);
  let response = await fetch(url, {
    headers: { Authorization: basicAuth(connection) },
    redirect: "manual",
    signal: timeout,
  });
  // Cloud answers downloads with a redirect to a signed media URL. Follow it
  // once, over https and without credentials, so the token never leaves the site.
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    const target = location ? new URL(location, url) : undefined;
    if (target?.protocol !== "https:") {
      throw new ToolExecutionError(
        "CONFLUENCE_UNTRUSTED_REDIRECT",
        "Confluence attachment download redirected to a non-https location.",
        { status: response.status, location },
      );
    }
    response = await fetch(target, { redirect: "error", signal: timeout });
  }
  if (!response.ok) {
    await throwConfluenceError(response, "GET", url.pathname);
  }
  const maximum = 25 * 1024 * 1024;
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maximum) {
    throw new ToolExecutionError(
      "CONFLUENCE_ATTACHMENT_TOO_LARGE",
      guideErrorMessage(
        "Confluence attachment exceeds the 25 MiB download limit.",
      ),
      { bytes: declared, maximum },
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximum) {
    throw new ToolExecutionError(
      "CONFLUENCE_ATTACHMENT_TOO_LARGE",
      guideErrorMessage(
        "Confluence attachment exceeds the 25 MiB download limit.",
      ),
      { bytes: bytes.byteLength, maximum },
    );
  }
  return bytes;
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
): Promise<never> {
  const body = await response.text().catch(() => "");
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
