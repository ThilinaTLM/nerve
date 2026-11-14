import { ExtensionError } from "@nervekit/extension-api";

/**
 * Validates a decoded JSON response and returns it typed. Parsers throw
 * `InvalidResponseShape` (or any Error) when the payload is not usable;
 * `readAtlassianJson` converts that into an `ExtensionError`.
 */
export type ResponseParser<T> = (value: unknown) => T;

class InvalidResponseShape extends Error {}

export type AtlassianRequestContext = {
  service: "jira" | "confluence";
  method: string;
  path: string;
};

const SNIPPET_LIMIT = 200;

/** Explicit opt-out: the payload is only forwarded, never inspected. */
export const anyJson: ResponseParser<unknown> = (value) => value;

export const jsonObject: ResponseParser<Record<string, unknown>> = (value) => {
  if (!isRecord(value))
    throw new InvalidResponseShape("expected a JSON object");
  return value;
};

export const jsonArray: ResponseParser<unknown[]> = (value) => {
  if (!Array.isArray(value))
    throw new InvalidResponseShape("expected a JSON array");
  return value;
};

/** Either of two parsers; the first that accepts the value wins. */
export function oneOf<A, B>(
  first: ResponseParser<A>,
  second: ResponseParser<B>,
): ResponseParser<A | B> {
  return (value) => {
    try {
      return first(value);
    } catch {
      return second(value);
    }
  };
}

/**
 * A JSON object whose listed fields, when present, satisfy their guards.
 * Other fields pass through untouched.
 */
export function objectWithFields<T extends Record<string, unknown>>(guards: {
  [K in keyof T]?: (value: unknown) => boolean;
}): ResponseParser<Record<string, unknown> & T> {
  return (value) => {
    const object = jsonObject(value);
    for (const [key, guard] of Object.entries(guards)) {
      const field = object[key];
      if (field === undefined || field === null) continue;
      if (!(guard as (value: unknown) => boolean)(field)) {
        throw new InvalidResponseShape(`field '${key}' has an unexpected type`);
      }
    }
    return object as Record<string, unknown> & T;
  };
}

export const isString = (value: unknown): value is string =>
  typeof value === "string";
export const isArray = (value: unknown): value is unknown[] =>
  Array.isArray(value);

/**
 * Read a successful response body as JSON. An empty body (including 204)
 * yields `undefined` and is only accepted by parsers that accept `undefined`
 * (`anyJson`); a non-JSON body (for example a proxy error page) is an error
 * carrying status, content type and a truncated snippet.
 */
export function readAtlassianJson<T>(
  response: { status: number; contentType: string; text: string },
  context: AtlassianRequestContext,
  parse: ResponseParser<T>,
): T {
  const text = response.status === 204 ? "" : response.text;
  let value: unknown;
  if (text.trim()) {
    try {
      value = JSON.parse(text);
    } catch {
      throw invalidResponse(response, context, text, "body is not valid JSON");
    }
  }
  try {
    return parse(value);
  } catch (error) {
    throw invalidResponse(
      response,
      context,
      text,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function invalidResponse(
  response: { status: number; contentType: string },
  context: AtlassianRequestContext,
  text: string,
  reason: string,
): ExtensionError {
  const label = context.service === "jira" ? "Jira" : "Confluence";
  const snippet = text.slice(0, SNIPPET_LIMIT);
  return new ExtensionError(
    "SERVER_ERROR",
    `${label} returned an unexpected response for ${context.method} ${context.path}: ${reason} (HTTP ${response.status}${response.contentType ? `, ${response.contentType}` : ""}${snippet ? `: ${snippet}` : ""}).`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
