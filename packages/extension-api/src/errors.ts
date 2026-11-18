/* Artifact names and the error extension code throws. */

// ── Artifact names ───────────────────────────────────────────────────────────

/** Whether `name` is a valid artifact name: 1–128 letters, digits, spaces, `.`, `_` or `-`; no folders, no leading dot or space, no trailing space. */
export function isArtifactName(name: string): boolean {
  return (
    /^[\p{L}\p{N}_][\p{L}\p{N} ._-]{0,127}$/u.test(name) && !name.endsWith(" ")
  );
}

// ── Errors ───────────────────────────────────────────────────────────────────

/**
 * What a script sees as `e.code`. `BAD_REQUEST` the input is wrong; `NOT_FOUND` the thing does
 * not exist; `CONFLICT` the state forbids it (a stale version); `FORBIDDEN` authenticated but
 * not allowed (HTTP 403); `DENIED` the permission policy or the extension's own allowlists refused
 * (`ctx.authorize`, an origin outside `permissions.network`); `RATE_LIMITED` try later;
 * `UNAUTHORIZED` the credential was rejected (HTTP 401; ends the run); `SERVER_ERROR` the service failed.
 */
export const EXTENSION_ERROR_CODES = [
  "BAD_REQUEST",
  "NOT_FOUND",
  "CONFLICT",
  "FORBIDDEN",
  "DENIED",
  "RATE_LIMITED",
  "UNAUTHORIZED",
  "SERVER_ERROR",
] as const;
/** One of `EXTENSION_ERROR_CODES`. */
export type ExtensionErrorCode = (typeof EXTENSION_ERROR_CODES)[number];

/**
 * A failure the agent can act on: throw it from `parse`, `authorize`, `run` or `test`. The script
 * sees `code` and the message, so say what happened and what to do next. `fix` says what the user
 * must do ("Ask the user to …"); the host appends it to the message. Messages of installed
 * extensions are cut at 600 characters, so keep them short. Another thrown error passes through
 * without a `code`, so scripts cannot branch on it.
 */
export class ExtensionError extends Error {
  /** Which kind of failure; see `EXTENSION_ERROR_CODES`. */
  readonly code: ExtensionErrorCode;
  /** What the user must do about it. */
  readonly fix?: string;

  /** `options.fix` becomes `fix`; `options.cause` is the underlying error. */
  constructor(
    code: ExtensionErrorCode,
    message: string,
    options: { fix?: string; cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ExtensionError";
    this.code = code;
    if (options.fix !== undefined) this.fix = options.fix;
  }
}
