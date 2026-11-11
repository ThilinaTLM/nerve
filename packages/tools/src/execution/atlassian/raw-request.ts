import { rm } from "node:fs/promises";
import { ToolExecutionError } from "../errors/tool-error.js";
import { BodyTooLargeError, streamBodyToFile } from "./stream-download.js";

/** Largest textual raw response body returned to a script. */
export const RAW_RESPONSE_MAX_BYTES = 5 * 1024 * 1024;
/** Largest binary raw response streamed to an artifact; matches the attachment transfer limit. */
export const RAW_BINARY_MAX_BYTES = 100 * 1024 * 1024;
/** Largest binary response handed to a buffering `onBinary` function. */
const RAW_BINARY_BUFFERED_MAX_BYTES = 25 * 1024 * 1024;

const RAW_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export function rawMethod(value: unknown): (typeof RAW_METHODS)[number] {
  const method = typeof value === "string" ? value.toUpperCase() : "";
  if (!(RAW_METHODS as readonly string[]).includes(method)) {
    throw new Error(`method must be one of ${RAW_METHODS.join(", ")}.`);
  }
  return method as (typeof RAW_METHODS)[number];
}

/**
 * Resolves a script-supplied path against the configured site. Only paths
 * under the allowed REST bases on the site's own origin are accepted; absolute
 * URLs, other hosts, `..` escapes and credentials are rejected.
 */
export function rawRequestUrl(
  siteUrl: string,
  path: unknown,
  allowedBases: readonly string[],
  query?: unknown,
): URL {
  const allowed = allowedBases.map((base) => `${base}…`).join(" or ");
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.startsWith("//")
  ) {
    throw new Error(
      `path must start with a single '/' and be relative to the site: ${allowed}. Absolute URLs are not allowed.`,
    );
  }
  const site = new URL(siteUrl);
  const url = new URL(path, site);
  if (
    url.origin !== site.origin ||
    url.username ||
    url.password ||
    !allowedBases.some((base) => url.pathname.startsWith(base))
  ) {
    throw new Error(`path must be under ${allowed}.`);
  }
  appendRawQuery(url, query);
  return url;
}

/** Adds a script-supplied `{ name: value | value[] }` object as properly encoded query parameters. */
function appendRawQuery(url: URL, query: unknown): void {
  if (query === undefined || query === null) return;
  if (typeof query !== "object" || Array.isArray(query)) {
    throw new Error("query must be an object of names to values.");
  }
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === "object" && item !== null) {
        throw new Error(`query.${name} must be a string, number or boolean.`);
      }
      url.searchParams.append(name, String(item));
    }
  }
}

const TEXTUAL_CONTENT_TYPE = /json|text|xml|javascript|x-www-form-urlencoded/i;

/**
 * Where a binary raw response goes. `prepare` returns a temporary path to
 * stream into; `commit` moves the finished file into place and returns what the
 * script sees. The temp file is removed if streaming or `commit` fails.
 */
export type BinarySink = {
  prepare: (contentType: string) => Promise<string>;
  commit: (
    path: string,
    bytes: number,
    contentType: string,
  ) => Promise<unknown>;
};

/** A sink streams to disk; a function receives the whole body in memory (capped at 25 MB). */
export type BinaryHandler =
  | BinarySink
  | ((bytes: Buffer, contentType: string) => Promise<unknown>);

/**
 * Reads a successful body (capped), returning parsed JSON when it is JSON and
 * text otherwise. With `onBinary`, a response whose content type is not
 * textual is handed to it instead of being decoded.
 */
export async function readRawBody(
  response: Response,
  onBinary?: BinaryHandler,
): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  const binary = Boolean(
    onBinary && contentType && !TEXTUAL_CONTENT_TYPE.test(contentType),
  );
  const sink = binary && typeof onBinary === "object" ? onBinary : undefined;
  const limit = !binary
    ? RAW_RESPONSE_MAX_BYTES
    : sink
      ? RAW_BINARY_MAX_BYTES
      : RAW_BINARY_BUFFERED_MAX_BYTES;
  const tooLarge = () =>
    new ToolExecutionError(
      "RESPONSE_TOO_LARGE",
      binary
        ? `Binary response is larger than ${limit / 1048576} MB.`
        : "Response is larger than 5 MB; narrow the request (fields, limit, paging).",
    );
  if (sink) {
    const path = await sink.prepare(contentType);
    try {
      const bytes = await streamBodyToFile(response, path, { maxBytes: limit });
      return await sink.commit(path, bytes, contentType);
    } catch (error) {
      await rm(path, { force: true });
      throw error instanceof BodyTooLargeError ? tooLarge() : error;
    }
  }
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > limit) {
    await response.body?.cancel();
    throw tooLarge();
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  }
  if (binary && typeof onBinary === "function") {
    return await onBinary(Buffer.concat(chunks), contentType);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
