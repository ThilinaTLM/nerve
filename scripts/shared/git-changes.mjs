import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ignored =
  /(?:^|\/)(?:node_modules|\.git)\/|^target\/|^packages\/[^/]+\/(?:(?:dist|prebuilds|\.svelte-kit|\.astro|\.vite|release|build)\/|native\/target\/)/;
const sorted = (values) => [...values].sort();

export function isIgnoredPath(path) {
  return ignored.test(path);
}

function runGit(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function readGitFile(root, baseline, path) {
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

export function readGitState(root, base = "origin/main") {
  const git = (args) => runGit(root, args);
  const revision = git([
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${base}^{commit}`,
  ]).trim();
  const baseline = git(["merge-base", revision, "HEAD"]).trim();
  // --no-renames gives both old and new endpoints and avoids rename parsing ambiguity.
  const comparisons = [[baseline], ["--cached", baseline], []];
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
          path && !isIgnoredPath(path) && existsSync(resolve(root, path)),
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
