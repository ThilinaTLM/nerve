/**
 * Canonical parser for untrusted project-relative paths (completions, launch
 * targets, project listing and mutations, desktop IPC).
 *
 * Pure string logic: no `node:path`, no filesystem. Containment checks
 * (resolve/relative/realpath) stay in node-side code. Backslashes are treated
 * as separators.
 *
 * Deliberately NOT used for tool paths (`~`, `@`, absolute paths allowed) or
 * harness ignore matching (`relativeEnvPath`); those solve different problems.
 */
export type ProjectRelativePath = string & {
  readonly __brand: "ProjectRelativePath";
};

export type ProjectPathFailureReason =
  | "empty"
  | "absolute"
  | "drive"
  | "nul"
  | "dot_segment"
  | "parent_segment"
  | "empty_segment";

export type ProjectPathResult =
  | { ok: true; path: ProjectRelativePath; segments: readonly string[] }
  | { ok: false; reason: ProjectPathFailureReason };

export interface ParseProjectRelativePathOptions {
  /** Accept empty input (and input that reduces to empty) as the root. */
  allowEmpty?: boolean;
  /** Drop `.` segments instead of rejecting them. */
  allowDot?: boolean;
  /** Ignore trailing slashes. */
  trimTrailingSlash?: boolean;
}

export function parseProjectRelativePath(
  input: string,
  options: ParseProjectRelativePathOptions = {},
): ProjectPathResult {
  if (input.includes("\0")) return { ok: false, reason: "nul" };
  let path = input.replaceAll("\\", "/");
  if (options.trimTrailingSlash) path = path.replace(/\/+$/, "");
  if (path.startsWith("/")) return { ok: false, reason: "absolute" };
  if (/^[A-Za-z]:\//.test(path)) return { ok: false, reason: "drive" };

  const segments: string[] = [];
  if (path !== "") {
    for (const segment of path.split("/")) {
      if (segment === ".") {
        if (!options.allowDot) return { ok: false, reason: "dot_segment" };
        continue;
      }
      if (segment === "..") return { ok: false, reason: "parent_segment" };
      if (segment === "") return { ok: false, reason: "empty_segment" };
      segments.push(segment);
    }
  }
  if (segments.length === 0 && !options.allowEmpty) {
    return { ok: false, reason: "empty" };
  }
  return {
    ok: true,
    path: segments.join("/") as ProjectRelativePath,
    segments,
  };
}
