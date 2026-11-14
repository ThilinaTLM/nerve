import { trimTrailingSlashes } from "../shared/site-url.js";
import type { IntegrationExecutionContext } from "@nervekit/tools/execution";
import { withTimeoutSignal } from "@nervekit/tools/execution";
import { safeAtlassianError } from "../shared/atlassian-error.js";
import { ToolExecutionError } from "@nervekit/tools/execution";
import {
  type BinaryHandler,
  rawRequestUrl,
  readRawBody,
} from "../shared/raw-request.js";
import {
  BodyTooLargeError,
  idleTimeoutSignal,
  streamBodyToFile,
} from "../shared/stream-download.js";
import {
  atlassianJsonRequestInit,
  basicAuthHeader,
  readAtlassianJson,
  type ResponseParser,
  anyJson,
} from "../shared/http.js";

export type JiraConnection = {
  siteUrl: string;
  email: string;
  token: string;
  defaultProjectKey?: string;
};

type JiraConfig = {
  enabled?: unknown;
  siteUrl?: unknown;
  email?: unknown;
  defaultProjectKey?: unknown;
};

export type JiraApiVersion = "platform" | "agile";

type QueryValue = string | number | boolean | string[] | undefined;

type JiraRequestOptions = {
  api?: JiraApiVersion;
  method?: string;
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  signal?: AbortSignal;
};

type Parsed<T> = { parse: ResponseParser<T> };

type JiraMultipartOptions = {
  path: string;
  form: FormData;
  signal?: AbortSignal;
};

export async function requireJiraConnection(
  context: IntegrationExecutionContext,
): Promise<JiraConnection> {
  const token = await context.getApiKey?.("jira");
  const rawConfig = (await context.getProviderConfig?.("jira")) as
    | JiraConfig
    | undefined;
  const siteUrl =
    typeof rawConfig?.siteUrl === "string"
      ? trimTrailingSlashes(rawConfig.siteUrl.trim())
      : "";
  const email =
    typeof rawConfig?.email === "string" ? rawConfig.email.trim() : "";
  const defaultProjectKey =
    typeof rawConfig?.defaultProjectKey === "string" &&
    rawConfig.defaultProjectKey.trim().length > 0
      ? rawConfig.defaultProjectKey.trim()
      : undefined;

  if (rawConfig?.enabled !== true || !siteUrl || !email || !token) {
    throw new ToolExecutionError(
      "JIRA_NOT_CONFIGURED",
      "Jira is not configured or enabled. Configure Jira site URL, Atlassian email, and API token in Nerve Settings, then enable the Jira module.",
      {
        enabled: rawConfig?.enabled === true,
        hasSiteUrl: Boolean(siteUrl),
        hasEmail: Boolean(email),
        hasToken: Boolean(token),
      },
    );
  }
  return { siteUrl, email, token, defaultProjectKey };
}

/**
 * Perform a Jira request. Pass `parse` to validate the consumed response
 * shape; without it the payload is returned as `unknown`.
 */
export function jiraRequest<T>(
  connection: JiraConnection,
  options: JiraRequestOptions & Parsed<T>,
): Promise<T>;
export function jiraRequest(
  connection: JiraConnection,
  options: JiraRequestOptions,
): Promise<unknown>;
export async function jiraRequest(
  connection: JiraConnection,
  options: JiraRequestOptions & Partial<Parsed<unknown>>,
): Promise<unknown> {
  const apiRoot = options.api === "agile" ? "/rest/agile/1.0" : "/rest/api/3";
  const url = new URL(`${connection.siteUrl}${apiRoot}${options.path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) url.searchParams.set(key, value.join(","));
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  const init = atlassianJsonRequestInit(basicAuth(connection), options);

  const response = await fetch(url, init);
  if (!response.ok) {
    await throwJiraError(response, init.method ?? "GET", options.path);
  }
  return readAtlassianJson(
    response,
    { service: "jira", method: init.method ?? "GET", path: options.path },
    options.parse ?? anyJson,
  );
}

/** REST bases `jira.request()` may call (platform v3 and agile). */
export const JIRA_RAW_BASES = ["/rest/api/3/", "/rest/agile/1.0/"] as const;

/** Raw request for `jira.request()`: any path under the allowed bases, JSON or text back. */
export async function jiraRawRequest(
  connection: JiraConnection,
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
    JIRA_RAW_BASES,
    options.query,
  );
  const init = atlassianJsonRequestInit(basicAuth(connection), options);
  const response = await fetch(url, init);
  if (!response.ok)
    await throwJiraError(response, options.method, url.pathname);
  return await readRawBody(response, options.onBinary);
}

export async function jiraMultipartRequest<T>(
  connection: JiraConnection,
  options: JiraMultipartOptions & Parsed<T>,
): Promise<T> {
  const url = new URL(`${connection.siteUrl}/rest/api/3${options.path}`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: basicAuth(connection),
      "X-Atlassian-Token": "nocheck",
    },
    body: options.form,
    signal: withTimeoutSignal(options.signal, UPLOAD_TIMEOUT_MS),
  });
  if (!response.ok) await throwJiraError(response, "POST", options.path);
  return readAtlassianJson(
    response,
    { service: "jira", method: "POST", path: options.path },
    options.parse,
  );
}

/** Uploads of up to 100 MB need longer than a JSON request. */
const UPLOAD_TIMEOUT_MS = 10 * 60_000;
const DIRECT_DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024;

function attachmentTooLarge(maximum: number, bytes: number) {
  return new ToolExecutionError(
    "JIRA_ATTACHMENT_TOO_LARGE",
    `Jira attachment exceeds the ${maximum / 1048576} MiB download limit.`,
    { bytes, maximum },
  );
}

/** Starts an attachment download; a redirect is refused so the token never leaves the site. */
async function openJiraDownload(
  connection: JiraConnection,
  attachmentId: string,
  signal: AbortSignal,
): Promise<Response> {
  const url = new URL(
    `${connection.siteUrl}/rest/api/3/attachment/content/${pathSegment(attachmentId)}`,
  );
  url.searchParams.set("redirect", "false");
  const response = await fetch(url, {
    headers: { Authorization: basicAuth(connection) },
    redirect: "manual",
    signal,
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    throw new ToolExecutionError(
      "JIRA_UNTRUSTED_DOWNLOAD_REDIRECT",
      "Jira attachment download attempted an authenticated redirect.",
      { location },
    );
  }
  if (!response.ok) {
    await throwJiraError(
      response,
      "GET",
      `/attachment/content/${pathSegment(attachmentId)}`,
    );
  }
  return response;
}

function downloadInfo(response: Response) {
  return {
    contentType: response.headers.get("content-type") ?? undefined,
    filename: filenameFromDisposition(
      response.headers.get("content-disposition"),
    ),
  };
}

export async function jiraDownload(
  connection: JiraConnection,
  attachmentId: string,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; contentType?: string; filename?: string }> {
  const maximum = DIRECT_DOWNLOAD_MAX_BYTES;
  const response = await openJiraDownload(
    connection,
    attachmentId,
    withTimeoutSignal(signal, 60_000),
  );
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maximum) throw attachmentTooLarge(maximum, declared);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximum) {
    throw attachmentTooLarge(maximum, bytes.byteLength);
  }
  return { bytes, ...downloadInfo(response) };
}

/**
 * Streams an attachment to `destination` (removed on failure or abort) with
 * the limit enforced on Content-Length and on the bytes received.
 */
export async function jiraDownloadToFile(
  connection: JiraConnection,
  attachmentId: string,
  options: { destination: string; maxBytes: number; signal?: AbortSignal },
): Promise<{ bytes: number; contentType?: string; filename?: string }> {
  const idle = idleTimeoutSignal(options.signal, 60_000);
  try {
    const response = await openJiraDownload(
      connection,
      attachmentId,
      idle.signal,
    );
    const bytes = await streamBodyToFile(response, options.destination, {
      maxBytes: options.maxBytes,
      signal: idle.signal,
      onChunk: idle.touch,
    }).catch((error: unknown) => {
      throw error instanceof BodyTooLargeError
        ? attachmentTooLarge(options.maxBytes, error.bytes)
        : error;
    });
    return { bytes, ...downloadInfo(response) };
  } finally {
    idle.dispose();
  }
}

function basicAuth(connection: JiraConnection): string {
  return basicAuthHeader(connection.email, connection.token);
}

function filenameFromDisposition(value: string | null): string | undefined {
  if (!value) return undefined;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  return /filename="?([^";]+)"?/i.exec(value)?.[1];
}

async function throwJiraError(
  response: Response,
  method: string,
  path: string,
): Promise<never> {
  const body = await response.text().catch(() => "");
  const code = jiraErrorCode(response.status);
  const retryable = response.status === 429 || response.status >= 500;
  const error = safeAtlassianError({
    service: "jira",
    code,
    method,
    path,
    status: response.status,
    statusText: response.statusText,
    body,
  });
  const message = response.status === 400 ? error.message : error.message;
  throw new ToolExecutionError(code, message, error.details, retryable);
}

function jiraErrorCode(status: number): string {
  if (status === 400) return "JIRA_BAD_REQUEST";
  if (status === 401) return "JIRA_UNAUTHORIZED";
  if (status === 403) return "JIRA_FORBIDDEN";
  if (status === 404) return "JIRA_NOT_FOUND";
  if (status === 429) return "JIRA_RATE_LIMITED";
  if (status >= 500) return "JIRA_SERVER_ERROR";
  return "JIRA_API_ERROR";
}

export function pathSegment(value: string): string {
  return encodeURIComponent(value);
}
