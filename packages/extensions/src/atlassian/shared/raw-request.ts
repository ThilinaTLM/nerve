import { ExtensionError } from "@nervekit/extension-api";
import type { ArtifactRef } from "@nervekit/extension-api";
import {
  bodyText,
  send,
  TEXT_RESPONSE_MAX_BYTES,
  type Connection,
  type Service,
} from "./transport.js";

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

function isArtifactRef(body: unknown): body is ArtifactRef {
  return (
    typeof body === "object" &&
    body !== null &&
    !(body instanceof Uint8Array) &&
    typeof (body as ArtifactRef).handle === "string"
  );
}

const TEXTUAL_CONTENT_TYPE = /json|text|xml|javascript|x-www-form-urlencoded/i;

/** Names the artifact a binary response is saved as: `<base>-<n><extension>`. */
export type BinaryNaming = {
  base: string;
  extensionFor: (contentType: string) => string;
};

/**
 * The raw request of `jira.request` / `confluence.request`: JSON or text
 * back, parsed when it is JSON. With `binary`, a response whose content type is
 * not textual is saved as an artifact and its handle returned. The body is held
 * in memory (the host's 20 MB limit); binary ones stream to an artifact (up to 100 MB).
 */
export async function sendRaw(
  connection: Connection,
  options: {
    service: Service;
    url: URL;
    method: string;
    body?: unknown;
    binary?: BinaryNaming;
  },
): Promise<unknown> {
  const hasBody =
    options.body !== undefined &&
    options.body !== null &&
    options.method !== "GET";
  const { binary } = options;
  const response = await send(connection, {
    service: options.service,
    url: options.url,
    method: options.method,
    ...(hasBody ? { body: { json: options.body } } : {}),
    // Non-textual responses stream to an artifact (up to 100 MB); textual ones stay in memory.
    response: binary
      ? {
          artifactFor: async (contentType) =>
            contentType && !TEXTUAL_CONTENT_TYPE.test(contentType)
              ? await connection.ctx.artifacts.freshName(
                  binary.base,
                  binary.extensionFor(contentType),
                )
              : undefined,
        }
      : "text",
    errorPath: options.url.pathname,
  });
  if (isArtifactRef(response.body)) return response.body.handle;
  const bytes = new TextEncoder().encode(bodyText(response));
  if (bytes.byteLength > TEXT_RESPONSE_MAX_BYTES)
    throw new ExtensionError(
      "BAD_REQUEST",
      "Response is larger than 5 MB; narrow the request (fields, limit, paging).",
    );
  const text = new TextDecoder().decode(bytes);
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
