import { lstat, readdir } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { projectPath } from "./project-migration-files.js";

/** Notices only: never decode an old file or use it as configuration. */
export async function findLegacyFiles(
  directory: string,
  patterns: readonly string[],
): Promise<string[]> {
  const root = resolve(directory, ".nerve");
  const files = new Set<string>();
  for (const pattern of patterns) {
    const target = resolve(root, pattern);
    const local = relative(root, target);
    if (
      !local ||
      local === ".." ||
      local.startsWith(`..${sep}`) ||
      isAbsolute(local)
    )
      throw new Error("Legacy filenames must be under project .nerve");
    // Only a filename wildcard is supported; do not recursively scan a project.
    if (dirname(pattern).includes("*") || /[?[\]]/.test(pattern))
      throw new Error("Unsupported legacy filename pattern");
    try {
      await projectPath(directory, join(dirname(pattern), ".legacy-check"));
    } catch {
      // Never follow an escaping directory link, including for discovery.
      continue;
    }
    const name = basename(pattern);
    const names = name.includes("*")
      ? await readdir(dirname(target)).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT" || error.code === "EACCES") return [];
          throw error;
        })
      : [name];
    const matcher = new RegExp(
      `^${name
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*")}$`,
    );
    for (const entry of names) {
      if (!matcher.test(entry)) continue;
      const file = join(dirname(target), entry);
      const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT" || error.code === "EACCES")
          return undefined;
        throw error;
      });
      if (info?.isFile() || info?.isSymbolicLink()) files.add(file);
    }
  }
  return [...files].sort();
}
