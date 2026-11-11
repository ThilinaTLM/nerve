import { ToolExecutionError } from "../errors/tool-error.js";

/** Largest raw response body returned to a script. */
export const RAW_RESPONSE_MAX_BYTES = 5 * 1024 * 1024;

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
  return url;
}

/** Reads a successful body (capped), returning parsed JSON when it is JSON and text otherwise. */
export async function readRawBody(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  const tooLarge = () =>
    new ToolExecutionError(
      "RESPONSE_TOO_LARGE",
      `Response is larger than ${RAW_RESPONSE_MAX_BYTES} bytes; narrow the request (fields, limit, paging).`,
    );
  if (declared > RAW_RESPONSE_MAX_BYTES) {
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
      if (bytes > RAW_RESPONSE_MAX_BYTES) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
