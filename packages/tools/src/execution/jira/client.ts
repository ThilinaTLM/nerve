import { Buffer } from "node:buffer";
import type { IntegrationExecutionContext } from "../execution-context.js";
import { withTimeoutSignal } from "../process/abort.js";
import { safeAtlassianError } from "../atlassian/atlassian-error.js";
import { ToolExecutionError } from "../errors/tool-error.js";

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
      ? rawConfig.siteUrl.trim().replace(/\/+$/, "")
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

export async function jiraRequest<T = unknown>(
  connection: JiraConnection,
  options: JiraRequestOptions,
): Promise<T> {
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

  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: basicAuth(connection),
  };
  const init: RequestInit = {
    method: options.method ?? "GET",
    headers,
    signal: withTimeoutSignal(options.signal, 60_000),
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, init);
  if (!response.ok) {
    await throwJiraError(response, init.method ?? "GET", options.path);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text.trim()) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

export async function jiraMultipartRequest<T = unknown>(
  connection: JiraConnection,
  options: JiraMultipartOptions,
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
    signal: withTimeoutSignal(options.signal, 60_000),
  });
  if (!response.ok) await throwJiraError(response, "POST", options.path);
  const text = await response.text();
  return (text.trim() ? JSON.parse(text) : undefined) as T;
}

export async function jiraDownload(
  connection: JiraConnection,
  attachmentId: string,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; contentType?: string; filename?: string }> {
  const url = new URL(
    `${connection.siteUrl}/rest/api/3/attachment/content/${pathSegment(attachmentId)}`,
  );
  url.searchParams.set("redirect", "false");
  const response = await fetch(url, {
    headers: { Authorization: basicAuth(connection) },
    redirect: "manual",
    signal: withTimeoutSignal(signal, 60_000),
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
  const declared = Number(response.headers.get("content-length") ?? 0);
  const maximum = 25 * 1024 * 1024;
  if (declared > maximum) {
    throw new ToolExecutionError(
      "JIRA_ATTACHMENT_TOO_LARGE",
      "Jira attachment exceeds the 25 MiB download limit.",
      { bytes: declared, maximum },
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximum) {
    throw new ToolExecutionError(
      "JIRA_ATTACHMENT_TOO_LARGE",
      "Jira attachment exceeds the 25 MiB download limit.",
      { bytes: bytes.byteLength, maximum },
    );
  }
  return {
    bytes,
    contentType: response.headers.get("content-type") ?? undefined,
    filename: filenameFromDisposition(
      response.headers.get("content-disposition"),
    ),
  };
}

function basicAuth(connection: JiraConnection): string {
  return `Basic ${Buffer.from(`${connection.email}:${connection.token}`, "utf8").toString("base64")}`;
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
  throw new ToolExecutionError(code, error.message, error.details, retryable);
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
