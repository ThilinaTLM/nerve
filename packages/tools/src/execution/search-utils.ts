import { constants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

export async function walkFiles(
  root: string,
  path: string,
  limit: number,
  onFile: (absolutePath: string, relativePath: string) => Promise<void>,
  shouldStop?: () => boolean,
): Promise<void> {
  if (shouldStop?.()) return;
  const info = await stat(path);
  if (info.isDirectory()) {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      if (shouldStop?.()) return;
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      await walkFiles(root, join(path, entry.name), limit, onFile, shouldStop);
    }
    return;
  }
  if (!info.isFile()) return;
  await access(path, constants.R_OK);
  await onFile(path, relative(root, path));
}

export function globToRegExp(pattern: string): RegExp {
  let output = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      output += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      output += "[^/]*";
      continue;
    }
    if (char === "?") {
      output += "[^/]";
      continue;
    }
    output += char?.replace(/[.+^${}()|[\]\\]/g, "\\$&") ?? "";
  }
  return new RegExp(`^${output}$`);
}
