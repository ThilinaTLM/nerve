import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, posix, sep } from "node:path";

export const sourceExtensions = /\.(?:[cm]?[jt]sx?|svelte)$/;

export function importSpecifiers(text) {
  const values = new Set();
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g,
    /(?:import|require)\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) values.add(match[1]);
  }
  return values;
}

export function resolvedImportPath(file, specifier) {
  return posix.normalize(posix.join(posix.dirname(file), specifier));
}

/** One inventory of tracked and non-ignored untracked source files, excluding deleted paths. */
export function createRepositorySourceInventory(repoRoot) {
  const contents = new Map();
  const files = trackedRepositoryFiles();
  return { repoRoot, files, read };

  function trackedRepositoryFiles() {
    const result = spawnSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`git ls-files failed with exit code ${result.status}`);
    return result.stdout
      .split("\0")
      .filter(Boolean)
      .map((path) => path.split(sep).join("/"))
      .filter((path) => existsSync(join(repoRoot, path)))
      .sort();
  }

  function read(file) {
    if (!contents.has(file))
      contents.set(file, readFileSync(join(repoRoot, file), "utf8"));
    return contents.get(file);
  }
}
