import { Buffer } from "node:buffer";
import type { ToolExecutionContext } from "../../types.js";
import { ToolExecutionError } from "../common/tool-error.js";

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

type JiraRequestOptions = {
  method?: string;
  path: string;
  query?: Record<string, string | number | boolean | string[] | undefined>;
  body?: unknown;
  signal?: AbortSignal;
};

export async function requireJiraConnection(
  context: ToolExecutionContext,
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
  const url = new URL(`${connection.siteUrl}/rest/api/3${options.path}`);
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
    Authorization: `Basic ${Buffer.from(`${connection.email}:${connection.token}`, "utf8").toString("base64")}`,
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
  if (!response.ok) await throwJiraError(response);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text.trim()) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

function timeoutSignal(
  signal: AbortSignal | undefined,
  milliseconds: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(milliseconds);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function throwJiraError(response: Response): Promise<never> {
  const body = await response.text().catch(() => "");
  const code = jiraErrorCode(response.status);
  const retryable = response.status === 429 || response.status >= 500;
  throw new ToolExecutionError(
    code,
    `Jira API error: ${response.status} ${response.statusText}`,
    {
      status: response.status,
      statusText: response.statusText,
      body: safeErrorBody(body),
    },
    retryable,
  );
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

function safeErrorBody(body: string): string | undefined {
  if (!body) return undefined;
  return body
    .replaceAll(/Basic\s+[A-Za-z0-9+/=_-]+/g, "Basic [redacted]")
    .slice(0, 4000);
}

export function pathSegment(value: string): string {
  return encodeURIComponent(value);
}
