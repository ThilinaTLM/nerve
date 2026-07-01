import { Buffer } from "node:buffer";
import type { ToolExecutionContext } from "../../types.js";
import { ToolExecutionError } from "../common/tool-error.js";

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

type MultipartAttachmentOptions = {
  method: "POST" | "PUT";
  pageId: string;
  form: FormData;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
};

export async function requireConfluenceConnection(
  context: ToolExecutionContext,
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
  let siteUrl = value.trim().replace(/\/+$/, "");
  if (siteUrl.endsWith("/wiki")) siteUrl = siteUrl.slice(0, -5);
  return siteUrl.replace(/\/+$/, "");
}

export async function confluenceRequest<T = unknown>(
  connection: ConfluenceConnection,
  options: ConfluenceRequestOptions,
): Promise<T> {
  const apiRoot = options.api === "v1" ? "/wiki/rest/api" : "/wiki/api/v2";
  const url = new URL(`${connection.siteUrl}${apiRoot}${options.path}`);
  appendQuery(url, options.query);

  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: basicAuth(connection),
  };
  const init: RequestInit = {
    method: options.method ?? "GET",
    headers,
    signal: timeoutSignal(options.signal, 60_000),
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, init);
  if (!response.ok) await throwConfluenceError(response);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text.trim()) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

export async function confluenceAttachmentRequest<T = unknown>(
  connection: ConfluenceConnection,
  options: MultipartAttachmentOptions,
): Promise<T> {
  const url = new URL(
    `${connection.siteUrl}/wiki/rest/api/content/${pathSegment(options.pageId)}/child/attachment`,
  );
  appendQuery(url, options.query);
  const response = await fetch(url, {
    method: options.method,
    headers: {
      Accept: "application/json",
      Authorization: basicAuth(connection),
      "X-Atlassian-Token": "nocheck",
    },
    body: options.form,
    signal: timeoutSignal(options.signal, 60_000),
  });
  if (!response.ok) await throwConfluenceError(response);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text.trim()) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

export async function confluenceDownload(
  connection: ConfluenceConnection,
  downloadLink: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const url = new URL(
    downloadLink.startsWith("http")
      ? downloadLink
      : `${connection.siteUrl}${downloadLink.startsWith("/") ? "" : "/"}${downloadLink}`,
  );
  const response = await fetch(url, {
    headers: { Authorization: basicAuth(connection) },
    signal: timeoutSignal(signal, 60_000),
  });
  if (!response.ok) await throwConfluenceError(response);
  return new Uint8Array(await response.arrayBuffer());
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
  return `Basic ${Buffer.from(`${connection.email}:${connection.token}`, "utf8").toString("base64")}`;
}

function timeoutSignal(
  signal: AbortSignal | undefined,
  milliseconds: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(milliseconds);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function throwConfluenceError(response: Response): Promise<never> {
  const body = await response.text().catch(() => "");
  const code = confluenceErrorCode(response.status);
  const retryable = response.status === 429 || response.status >= 500;
  throw new ToolExecutionError(
    code,
    `Confluence API error: ${response.status} ${response.statusText}`,
    {
      status: response.status,
      statusText: response.statusText,
      body: safeErrorBody(body),
    },
    retryable,
  );
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

function safeErrorBody(body: string): string | undefined {
  if (!body) return undefined;
  return body
    .replaceAll(/Basic\s+[A-Za-z0-9+/=_-]+/g, "Basic [redacted]")
    .replaceAll(/[A-Za-z0-9_-]{20,}/g, "[redacted]")
    .slice(0, 4000);
}

export function pathSegment(value: string): string {
  return encodeURIComponent(value);
}
