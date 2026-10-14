import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ignored =
  /(?:^|\/)(?:node_modules|\.git)\/|^target\/|^packages\/[^/]+\/(?:(?:dist|prebuilds|\.svelte-kit|\.astro|\.vite|release|build)\/|native\/target\/)/;
const sorted = (values) => [...values].sort();

export function isIgnoredPath(path) {
  return ignored.test(path);
}

export function readGitState(root, base = "origin/main") {
  function git(args) {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
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
