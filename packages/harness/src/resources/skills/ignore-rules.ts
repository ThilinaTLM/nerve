import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import ignore from "ignore";

/** Ignore files every resource discovery honours, in this order. */
export const IGNORE_FILE_NAMES = [".gitignore", ".ignore", ".fdignore"];

export function prefixIgnorePattern(
  line: string,
  prefix: string,
): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#") && !trimmed.startsWith("\\#")) return null;

  let pattern = line;
  let negated = false;
  if (pattern.startsWith("!")) {
    negated = true;
    pattern = pattern.slice(1);
  } else if (pattern.startsWith("\\!")) {
    pattern = pattern.slice(1);
  }
  if (pattern.startsWith("/")) pattern = pattern.slice(1);
  const prefixed = prefix ? `${prefix}${pattern}` : pattern;
  return negated ? `!${prefixed}` : prefixed;
}

/**
 * The entries of directory `dir` that its own ignore files (`.gitignore`, `.ignore`, `.fdignore`)
 * do not ignore, as the skill discovery reads them. Dot entries and `node_modules` are skipped
 * as in skill discovery. A missing directory has no entries.
 */
export async function listUnignoredEntries(
  dir: string,
): Promise<{ name: string; isDirectory: boolean }[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const matcher = ignore();
  for (const name of IGNORE_FILE_NAMES) {
    let content: string;
    try {
      content = await readFile(join(dir, name), "utf8");
    } catch {
      continue;
    }
    const patterns = content
      .split(/\r?\n/)
      .map((line) => prefixIgnorePattern(line, ""))
      .filter((line): line is string => Boolean(line));
    if (patterns.length > 0) matcher.add(patterns);
  }
  return entries
    .filter(
      (entry) =>
        !entry.name.startsWith(".") &&
        entry.name !== "node_modules" &&
        !matcher.ignores(entry.isDirectory() ? `${entry.name}/` : entry.name),
    )
    .map((entry) => ({
      name: entry.name,
      // A symlink to a directory counts as a directory; the caller resolves it.
      isDirectory: entry.isDirectory() || entry.isSymbolicLink(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
