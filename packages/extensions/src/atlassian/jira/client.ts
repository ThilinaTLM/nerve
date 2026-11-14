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
  send,
  sendJson,
  TRANSFER_TIMEOUT_MS,
  type Connection,
} from "../shared/transport.js";
import { readJson } from "../shared/transport.js";
import type { ResponseParser } from "../shared/http.js";

/** The run's Jira connection: `ctx` plus the account's site. Credentials never reach it. */
export type JiraConnection = Connection & {
  defaultProjectKey?: string;
};

export type JiraApiVersion = "platform" | "agile";

type QueryValue = string | number | boolean | string[] | undefined;

type JiraRequestOptions = {
  api?: JiraApiVersion;
  method?: string;
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  timeoutMs?: number;
};

type Parsed<T> = { parse: ResponseParser<T> };

/** The site URL of an account as requests use it: no trailing slash. */
export function jiraSiteUrl(value: string): string {
  return trimTrailingSlashes(value.trim());
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
  return await sendJson(connection, {
    service: "jira",
    url,
    method: options.method,
    body: options.body,
    errorPath: options.path,
    timeoutMs: options.timeoutMs,
    parse: options.parse,
  });
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
    /** Saves a binary response as an artifact (GET only). */
    binary?: BinaryNaming;
  },
): Promise<unknown> {
  const url = rawRequestUrl(
    connection.siteUrl,
    options.path,
    JIRA_RAW_BASES,
    options.query,
  );
  return await sendRaw(connection, {
    service: "jira",
    url,
    method: options.method,
    body: options.body,
    binary: options.binary,
  });
}

/** Multipart upload to `/rest/api/3<path>` with Atlassian's CSRF bypass; the host sets the content type. */
export async function jiraMultipartRequest<T>(
  connection: JiraConnection,
  options: { path: string; parts: readonly FormPart[] } & Parsed<T>,
): Promise<T> {
  const url = new URL(`${connection.siteUrl}/rest/api/3${options.path}`);
  const response = await send(connection, {
    service: "jira",
    url,
    method: "POST",
    headers: { "X-Atlassian-Token": "nocheck" },
    body: { form: options.parts },
    timeoutMs: TRANSFER_TIMEOUT_MS,
    errorPath: options.path,
  });
  return readJson(
    response,
    { service: "jira", method: "POST", path: options.path },
    options.parse,
  );
}

function filenameFromDisposition(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  return /filename="?([^";]+)"?/i.exec(value)?.[1];
}

/**
 * Streams an attachment into the artifact `name`; `redirect=false` makes Jira
 * answer with the content itself, so the credential never leaves the site.
 */
export async function jiraDownloadToArtifact(
  connection: JiraConnection,
  attachmentId: string,
  options: { name: string; maxBytes?: number },
): Promise<{ artifact: ArtifactRef; contentType?: string; filename?: string }> {
  const path = `/attachment/content/${pathSegment(attachmentId)}`;
  const url = new URL(`${connection.siteUrl}/rest/api/3${path}`);
  url.searchParams.set("redirect", "false");
  const response = await send(connection, {
    service: "jira",
    url,
    response: { artifact: options.name },
    timeoutMs: TRANSFER_TIMEOUT_MS,
    maxBytes: options.maxBytes ?? MAX_ATTACHMENT_BYTES,
    errorPath: path,
  });
  return {
    artifact: response.body as ArtifactRef,
    contentType: response.headers["content-type"],
    filename: filenameFromDisposition(response.headers["content-disposition"]),
  };
}

/** Rejects a download beyond the attachment limit with the one message scripts see. */
export function attachmentTooLarge(id: string, size: number): ExtensionError {
  return new ExtensionError(
    "BAD_REQUEST",
    `Attachment ${id} is ${(size / 1048576).toFixed(1)} MB; the limit is ${MAX_ATTACHMENT_BYTES / 1048576} MB.`,
  );
}

export function pathSegment(value: string): string {
  return encodeURIComponent(value);
}
