import {
  ExtensionError,
  type ExtensionErrorCode,
} from "@nervekit/extension-api";

/** An error with a script-visible code and no further data. */
export function codedError(
  code: ExtensionErrorCode,
  message: string,
): ExtensionError {
  return new ExtensionError(code, message);
}

/**
 * Jira or Confluence answered a request with an error status. `message` is the
 * full transport text (`Jira GET /x failed (404 Not Found): reason`), `reason`
 * what the service said; failures of methods read as `reason` alone.
 */
export class AtlassianApiError extends ExtensionError {
  constructor(
    code: ExtensionErrorCode,
    message: string,
    readonly status: number,
    readonly reason: string | undefined,
  ) {
    super(code, message);
    this.name = "AtlassianApiError";
  }
}

/** The service answered with exactly this status (400 for an unsupported lookup, 404 for a missing entity). */
export function hasStatus(
  error: unknown,
  ...statuses: number[]
): error is AtlassianApiError {
  return error instanceof AtlassianApiError && statuses.includes(error.status);
}

/**
 * `.catch` handler for an optional lookup: `fallback` when the API says it is
 * not there or not supported (404/400); anything else, such as 5xx, is a real
 * failure. A 401/403 never reaches it: the host ends the call first.
 */
export function orWhenUnsupported<T>(fallback: () => T | Promise<T>) {
  return (error: unknown): T | Promise<T> => {
    if (hasStatus(error, 404, 400)) return fallback();
    throw error;
  };
}

/** The HTTP status's script-visible code. */
export function codeForStatus(status: number): ExtensionErrorCode {
  if (status === 400) return "BAD_REQUEST";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  return "SERVER_ERROR";
}
