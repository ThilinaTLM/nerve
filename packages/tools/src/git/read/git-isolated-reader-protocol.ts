import type {
  NativeErrorCategory,
  NativeErrorDetail,
  NativeGitFileStatus,
  NativeGitProjectRepository,
  NativeGitProjectSnapshot,
  NativeGitSnapshot,
  NativeGitStatusCounts,
} from "@nervekit/native";
import { gitPathKey } from "../git-path-key.js";

export const GIT_ISOLATED_INPUT_BYTES = 8 * 1024;
export const GIT_ISOLATED_OUTPUT_BYTES = 8 * 1024 * 1024;
export const GIT_ISOLATED_STDERR_BYTES = 64 * 1024;
export const GIT_ISOLATED_MAX_FILES = 20_000;
export const GIT_ISOLATED_MAX_PATH_BYTES = 4096;
export const GIT_ISOLATED_TIMEOUT_MS = 30_000;
export const GIT_ISOLATED_MAX_TIMEOUT_MS = 120_000;

export interface GitIsolatedInput {
  expected: GitIsolatedIdentity;
  includeIgnored: boolean;
}
export type GitIsolatedIdentity = Pick<
  NativeGitProjectRepository,
  "workDir" | "gitDir" | "commonDir"
>;
export function sameGitIsolatedIdentity(
  actual: GitIsolatedIdentity,
  expected: GitIsolatedIdentity,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return (["workDir", "gitDir", "commonDir"] as const).every(
    (key) =>
      gitPathKey(actual[key], platform) === gitPathKey(expected[key], platform),
  );
}
export type GitIsolatedFrame =
  | {
      version: 1;
      ok: true;
      identity: GitIsolatedIdentity;
      snapshot: NativeGitProjectSnapshot;
    }
  | { version: 1; ok: false; error: NativeErrorDetail };

export function isolatedError(
  category: NativeErrorCategory,
  retryable = false,
): NativeErrorDetail {
  return {
    category,
    retryable,
    message:
      category === "cancelled"
        ? "Isolated Git read cancelled."
        : category === "limit_exceeded"
          ? "Isolated Git read resource or output limit reached."
          : "Isolated Git read failed.",
  };
}
export function categoryOf(error: unknown): NativeErrorCategory {
  if (error && typeof error === "object" && "category" in error) {
    const category = error.category;
    if (
      typeof category === "string" &&
      [
        "not_repository",
        "not_found",
        "unsupported",
        "isolation_required",
        "invalid_input",
        "io",
        "corrupt",
        "limit_exceeded",
        "cancelled",
        "internal",
      ].includes(category)
    )
      return category as NativeErrorCategory;
  }
  return "internal";
}
function invalid(): never {
  throw new Error("Invalid isolated Git protocol");
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum = GIT_ISOLATED_MAX_PATH_BYTES): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\0") ||
    Buffer.byteLength(value) > maximum
  )
    return invalid();
  return value;
}
function optionalText(value: unknown, maximum?: number): string | undefined {
  return value === undefined ? undefined : text(value, maximum);
}
function optionalCount(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 0xffff_ffff
  )
    return invalid();
  return value;
}
function filePath(value: unknown): string {
  const path = text(value);
  if (
    path.startsWith("/") ||
    /^[a-z]:[\\/]/i.test(path) ||
    path.split("/").includes("..")
  )
    return invalid();
  return path;
}
export function serializeGitIsolatedInput(
  repository: NativeGitProjectRepository,
  includeIgnored: boolean,
): string {
  // C owns authorization; this is resource/shape validation, not an authorization bypass.
  for (const path of [
    repository.relativePath,
    repository.workDir,
    repository.gitDir,
    repository.commonDir,
  ])
    text(path);
  const input = JSON.stringify({
    expected: {
      workDir: repository.workDir,
      gitDir: repository.gitDir,
      commonDir: repository.commonDir,
    },
    includeIgnored,
  });
  if (Buffer.byteLength(input) > GIT_ISOLATED_INPUT_BYTES)
    throw isolatedError("limit_exceeded");
  return input;
}
export function parseGitIsolatedInput(input: string): GitIsolatedInput {
  if (Buffer.byteLength(input) > GIT_ISOLATED_INPUT_BYTES)
    throw isolatedError("limit_exceeded");
  const value = record(JSON.parse(input));
  if (typeof value.includeIgnored !== "boolean") return invalid();
  const expected = record(value.expected);
  return {
    expected: {
      workDir: text(expected.workDir),
      gitDir: text(expected.gitDir),
      commonDir: text(expected.commonDir),
    },
    includeIgnored: value.includeIgnored,
  };
}

/** Representation normalization only: the sole Git computation is native gix. */
export function normalizeGitIsolatedSnapshot(
  input: unknown,
): NativeGitProjectSnapshot {
  const value = record(input);
  if (
    typeof value.detached !== "boolean" ||
    !Array.isArray(value.files) ||
    !Array.isArray(value.inProgress) ||
    value.inProgress.length > 5
  )
    return invalid();
  if (value.files.length > GIT_ISOLATED_MAX_FILES)
    throw isolatedError("limit_exceeded");
  const inProgress = value.inProgress.map((state) => text(state, 32));
  if (
    new Set(inProgress).size !== inProgress.length ||
    inProgress.some(
      (state) =>
        !["merge", "rebase", "cherry_pick", "revert", "bisect"].includes(state),
    )
  )
    return invalid();
  const counts: NativeGitStatusCounts = {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    ignored: 0,
    conflicted: 0,
  };
  const files: NativeGitFileStatus[] = [];
  const seen = new Set<string>();
  let bytes = 0;
  for (const item of value.files) {
    const file = record(item);
    const path = filePath(file.path);
    if (seen.has(path)) return invalid();
    seen.add(path);
    const index = text(file.index, 1),
      worktree = text(file.worktree, 1);
    if (
      ![index, worktree].every((code) =>
        [" ", "M", "A", "D", "R", "C", "U", "?", "!"].includes(code),
      ) ||
      typeof file.untracked !== "boolean" ||
      typeof file.ignored !== "boolean"
    )
      return invalid();
    const renamedFrom =
      file.renamedFrom === undefined ? undefined : filePath(file.renamedFrom);
    const normalized = {
      path,
      index,
      worktree,
      untracked: file.untracked,
      ignored: file.ignored,
      ...(renamedFrom === undefined ? {} : { renamedFrom }),
    };
    bytes += Buffer.byteLength(JSON.stringify(normalized));
    if (bytes > GIT_ISOLATED_OUTPUT_BYTES - 64 * 1024)
      throw isolatedError("limit_exceeded");
    files.push(normalized);
    if (normalized.ignored) counts.ignored++;
    else if (normalized.untracked) counts.untracked++;
    else {
      if (index !== " ") counts.staged++;
      if (worktree !== " ") counts.unstaged++;
      if (index === "U" || worktree === "U") counts.conflicted++;
    }
  }
  return {
    headOid: optionalText(value.headOid, 128),
    branch: optionalText(value.branch),
    detached: value.detached,
    upstream: optionalText(value.upstream),
    ahead: optionalCount(value.ahead),
    behind: optionalCount(value.behind),
    inProgress,
    counts,
    files,
  };
}
export function lightGitIsolatedSnapshot(
  snapshot: NativeGitSnapshot,
): NativeGitProjectSnapshot {
  return normalizeGitIsolatedSnapshot({
    headOid: snapshot.headOid,
    branch: snapshot.headBranch,
    detached: snapshot.detached,
    upstream: snapshot.upstream,
    ahead: snapshot.ahead,
    behind: snapshot.behind,
    inProgress: snapshot.inProgress,
    files: snapshot.files,
  });
}
export function serializeGitIsolatedFrame(frame: GitIsolatedFrame): string {
  const serialized = JSON.stringify(frame) + "\n";
  return Buffer.byteLength(serialized) <= GIT_ISOLATED_OUTPUT_BYTES
    ? serialized
    : JSON.stringify({
        version: 1,
        ok: false,
        error: isolatedError("limit_exceeded"),
      }) + "\n";
}
export function parseGitIsolatedFrame(
  serialized: string,
  expected: NativeGitProjectRepository,
  platform: NodeJS.Platform = process.platform,
): NativeGitProjectSnapshot | NativeErrorDetail {
  const frame = record(JSON.parse(serialized));
  if (frame.version !== 1 || typeof frame.ok !== "boolean") return invalid();
  if (!frame.ok) return isolatedError(categoryOf(record(frame.error)));
  const identity = record(frame.identity);
  if (
    !sameGitIsolatedIdentity(
      {
        workDir: text(identity.workDir),
        gitDir: text(identity.gitDir),
        commonDir: text(identity.commonDir),
      },
      expected,
      platform,
    )
  )
    return invalid();
  const snapshot = normalizeGitIsolatedSnapshot(frame.snapshot);
  const counts = record(record(frame.snapshot).counts);
  for (const key of [
    "staged",
    "unstaged",
    "untracked",
    "ignored",
    "conflicted",
  ] as const)
    if (counts[key] !== snapshot.counts[key]) return invalid();
  return snapshot;
}
