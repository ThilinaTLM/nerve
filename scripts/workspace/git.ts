import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const buildOutput =
  /(?:^|\/)(?:node_modules|\.git)\/|^target\/|^packages\/[^/]+\/(?:(?:dist|prebuilds|\.svelte-kit|\.astro|\.vite|release|build)\/|native\/target\/)/;
const sorted = (values: Iterable<string>) => [...values].sort();

/** Build outputs, dependency trees and Git internals: never part of any change or inventory. */
export function isBuildOutput(path: string): boolean {
  return buildOutput.test(path);
}

/** Local working-tree view relative to a base revision. */
export interface GitState {
  /** Changed paths since the merge-base, staged, unstaged and untracked (sorted, deduplicated). */
  paths: string[];
  /** Paths that no longer exist in the working tree relative to the baseline. */
  deleted: Set<string>;
  /** Existing tracked and untracked-nonignored files (sorted). */
  files: string[];
  /** Merge-base commit of `base` and HEAD. */
  baseline: string;
  base: string;
}

function runGit(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Contents of `path` at `baseline`, or null when the path did not exist there. */
export function readGitFile(
  root: string,
  baseline: string,
  path: string,
): string | null {
  const revision = runGit(root, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${baseline}^{commit}`,
  ]).trim();
  // Check the tree first: a missing path is not the same as a failed Git read.
  const entries = runGit(root, [
    "--literal-pathspecs",
    "ls-tree",
    "--full-tree",
    "-z",
    revision,
    "--",
    path,
  ]).split("\0");
  const entry = entries.find(
    (entry) => entry && entry.slice(entry.indexOf("\t") + 1) === path,
  );
  if (!entry) return null;
  const [, type, object] = entry.slice(0, entry.indexOf("\t")).split(" ");
  if (type !== "blob") throw new Error(`Git path is not a file: ${path}`);
  return runGit(root, ["cat-file", "blob", object]);
}

export function readGitState(root: string, base = "origin/main"): GitState {
  const git = (args: string[]) => runGit(root, args);
  const revision = git([
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${base}^{commit}`,
  ]).trim();
  const baseline = git(["merge-base", revision, "HEAD"]).trim();
  // --no-renames gives both old and new endpoints and avoids rename parsing ambiguity.
  const comparisons: string[][] = [[baseline], ["--cached", baseline], []];
  const paths = comparisons.flatMap((comparison) =>
    git(["diff", "--name-only", "--no-renames", "-z", ...comparison, "--"])
      .split("\0")
      .filter(Boolean),
  );
  const deleted = new Set(
    comparisons.flatMap((comparison) =>
      git([
        "diff",
        "--name-only",
        "--no-renames",
        "--diff-filter=D",
        "-z",
        ...comparison,
        "--",
      ])
        .split("\0")
        .filter(Boolean),
    ),
  );
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean);
  const files = sorted(
    new Set(
      [...git(["ls-files", "-z"]).split("\0"), ...untracked].filter(
        (path) =>
          path && !isBuildOutput(path) && existsSync(resolve(root, path)),
      ),
    ),
  );
  return {
    paths: sorted(new Set([...paths, ...untracked])),
    deleted,
    files,
    baseline,
    base,
  };
}

/** Paths changed between `base...head` (three-dot), as CI sees a pull request. */
export function readChangedPaths(
  root: string,
  base: string,
  head = "HEAD",
): string[] {
  if (!base) throw new Error("A Git base revision is required");
  return runGit(root, ["diff", "--name-only", "-z", `${base}...${head}`])
    .split("\0")
    .filter(Boolean);
}
