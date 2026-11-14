import type {
  ExtensionContext,
  HttpRequest,
  HttpResponse,
} from "@nervekit/extension-api";
import { safeAtlassianError } from "./atlassian-error.js";
import { AtlassianApiError, codeForStatus } from "./errors.js";
import {
  anyJson,
  readAtlassianJson,
  type AtlassianRequestContext,
  type ResponseParser,
} from "./http.js";

/**
 * Every Jira and Confluence request goes through `ctx.http` with the extension's
 * `account` setting: the host checks the origin, injects the credential, follows
 * redirects without it and ends the call on 401/403.
 */

/** Where a method's connection lives: the run's `ctx` and the account's site. */
export type Connection = { ctx: ExtensionContext; siteUrl: string };

export type Service = "jira" | "confluence";

/** The `account` setting the credential comes from. */
export const ACCOUNT_SETTING = "account";

/** The host's longest request time; uploads and downloads of up to 100 MB need it. */
export const TRANSFER_TIMEOUT_MS = 5 * 60_000;

/** Largest textual response returned to a script. */
export const TEXT_RESPONSE_MAX_BYTES = 5 * 1024 * 1024;

export type SendOptions = {
  service: Service;
  url: URL;
  method?: string;
  headers?: Record<string, string>;
  body?: HttpRequest["body"];
  response?: Exclude<HttpRequest["response"], "json" | undefined>;
  timeoutMs?: number;
  maxBytes?: number;
  /** Path shown in errors (never the query). */
  errorPath: string;
  /** Turns the error response's text into the reason the service gave. */
  errorReason?: (text: string) => string;
};

const decoder = new TextDecoder();

/** The response body as text; empty for none or for a streamed artifact. */
export function bodyText(response: HttpResponse): string {
  const { body } = response;
  return typeof body === "string"
    ? body
    : body instanceof Uint8Array
      ? decoder.decode(body)
      : "";
}

/** Sends one request; any status outside 2xx (and 401/403, which the host ends) becomes an `AtlassianApiError`. */
export async function send(
  connection: Connection,
  options: SendOptions,
): Promise<HttpResponse> {
  const method = (options.method ?? "GET").toUpperCase();
  const response = await connection.ctx.http.request({
    url: options.url.toString(),
    method,
    headers: { Accept: "application/json", ...options.headers },
    ...(options.body === undefined ? {} : { body: options.body }),
    auth: { account: ACCOUNT_SETTING },
    response: options.response ?? "text",
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
  });
  if (!response.ok) {
    const text = bodyText(response);
    const error = safeAtlassianError({
      service: options.service,
      method,
      path: options.errorPath,
      status: response.status,
      body: options.errorReason ? options.errorReason(text) : text,
    });
    throw new AtlassianApiError(
      codeForStatus(response.status),
      error.message,
      response.status,
      error.reason,
    );
  }
  return response;
}

/** A JSON request: `body` is sent as JSON (never on GET/HEAD) and the response validated by `parse`. */
export async function sendJson<T>(
  connection: Connection,
  options: Omit<SendOptions, "body" | "response"> & {
    /** JSON-serializable request body. */
    body?: unknown;
    parse?: ResponseParser<T>;
  },
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  // A positional `undefined` crosses the sandbox bridge as null; GET/HEAD never carry a body.
  const hasBody =
    options.body !== undefined &&
    options.body !== null &&
    method !== "GET" &&
    method !== "HEAD";
  const response = await send(connection, {
    service: options.service,
    url: options.url,
    method,
    headers: options.headers,
    ...(hasBody ? { body: { json: options.body } } : {}),
    response: "text",
    timeoutMs: options.timeoutMs,
    maxBytes: options.maxBytes,
    errorPath: options.errorPath,
    errorReason: options.errorReason,
  });
  return readJson(
    response,
    { service: options.service, method, path: options.errorPath },
    options.parse ?? (anyJson as never),
  );
}

export function readJson<T>(
  response: HttpResponse,
  context: AtlassianRequestContext,
  parse: ResponseParser<T>,
): T {
  return readAtlassianJson(
    {
      status: response.status,
      contentType: response.headers["content-type"] ?? "",
      text: bodyText(response),
    },
    context,
    parse,
  );
}
