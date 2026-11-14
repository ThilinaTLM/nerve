import { basename, sep } from "node:path";
import { ToolExecutionError } from "../../execution/index.js";

/** What a script sees as `HostError.code`; every host failure has one of these. */
export const HOST_ERROR_CODES = [
  "BAD_REQUEST",
  "NOT_FOUND",
  "CONFLICT",
  "FORBIDDEN",
  "DENIED",
  "RATE_LIMITED",
  "UNAUTHORIZED",
  "SERVER_ERROR",
] as const;

export type HostErrorCode = (typeof HOST_ERROR_CODES)[number];

const isHostErrorCode = (code: string): code is HostErrorCode =>
  (HOST_ERROR_CODES as readonly string[]).includes(code);

/** An error whose `code` reaches the script unchanged as `e.code`. */
export function codedError(
  code: HostErrorCode,
  message: string,
): ToolExecutionError {
  return new ToolExecutionError(code, message);
}

/**
 * Maps any failure to the script-visible code. NESTED_* policy refusals are
 * `DENIED`; other codes and plain errors (validation, prepare, unknown method)
 * are `BAD_REQUEST`.
 */
export function hostErrorCode(error: unknown): HostErrorCode {
  if (!(error instanceof ToolExecutionError))
    return (error as { code?: unknown } | null)?.code === "ENOENT"
      ? "NOT_FOUND"
      : "BAD_REQUEST";
  const { code } = error;
  if (isHostErrorCode(code)) return code;
  if (code.startsWith("NESTED_")) return "DENIED";
  return "BAD_REQUEST";
}

/** Where host paths in error messages are shown relative to: the workspace and the artifact folder. */
export type DisplayPaths = { cwd: string; artifactDir?: string };

const ERRNO_TEXT: Record<string, string> = {
  ENOENT: "not found",
  EACCES: "permission denied",
  EPERM: "permission denied",
  EISDIR: "is a directory",
  ENOTDIR: "not a directory",
  EEXIST: "already exists",
  ENOSPC: "no space left on device",
};

/**
 * A file-system failure (`ENOENT: no such file or directory, open '/home/…'`)
 * as `not found: artifact:x.png` / `not found: src/a.ts`: artifacts by handle,
 * workspace paths relative, anything else by file name only.
 */
export function errnoMessage(
  error: unknown,
  paths?: DisplayPaths,
): string | undefined {
  const { code, path } = (error ?? {}) as { code?: unknown; path?: unknown };
  if (typeof code !== "string" || typeof path !== "string" || !paths)
    return undefined;
  const text = ERRNO_TEXT[code];
  if (!text) return undefined;
  const within = (root: string | undefined) => {
    if (!root) return undefined;
    const relative = path.startsWith(root + sep)
      ? path.slice(root.length + 1)
      : undefined;
    return relative;
  };
  const artifact = within(paths.artifactDir);
  const workspace = within(paths.cwd);
  const shown =
    artifact !== undefined
      ? `artifact:${artifact}`
      : (workspace ?? basename(path));
  return `${text}: ${shown}`;
}
