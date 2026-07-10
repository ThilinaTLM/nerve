import { constants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { isErrnoException, resolveToolPath } from "../filesystem/path.js";

export type SearchScope = {
  roots: string[];
  displayRoot: string;
};

type SearchScopeRoot = {
  input: string;
  path: string;
  kind: "file" | "directory";
};

export async function resolveSearchScope(
  cwd: string,
  args: Record<string, unknown>,
  toolName: string,
): Promise<SearchScope> {
  if (args.path !== undefined && args.paths !== undefined) {
    throw new Error(`${toolName} accepts either 'path' or 'paths', not both.`);
  }

  const inputs = searchScopeInputs(args, toolName);
  const roots: SearchScopeRoot[] = [];
  for (const input of inputs) {
    const path = resolveToolPath(cwd, input);
    const info = await stat(path).catch((error: unknown) => {
      if (isErrnoException(error) && error.code === "ENOENT") {
        throw new Error(
          `${toolName} path not found: ${JSON.stringify(input)} (resolved to ${path}). Pass one path in 'path' or multiple paths as 'paths': [...].`,
        );
      }
      throw error;
    });
    if (!info.isFile() && !info.isDirectory()) {
      throw new Error(
        `${toolName} path is not a file or directory: ${JSON.stringify(input)} (resolved to ${path}).`,
      );
    }
    roots.push({
      input,
      path,
      kind: info.isDirectory() ? "directory" : "file",
    });
  }

  const rootBases = roots.map((root) =>
    root.kind === "directory" ? root.path : dirname(root.path),
  );
  const displayRoot =
    rootBases.length === 1 ? rootBases[0] : commonAncestor(rootBases);
  return { roots: roots.map((root) => root.path), displayRoot };
}

function searchScopeInputs(
  args: Record<string, unknown>,
  toolName: string,
): string[] {
  if (args.paths !== undefined) {
    if (!Array.isArray(args.paths) || args.paths.length === 0) {
      throw new Error(
        `${toolName} 'paths' must be a non-empty array of strings.`,
      );
    }
    return args.paths.map((input) => {
      if (typeof input !== "string" || input.trim().length === 0) {
        throw new Error(
          `${toolName} 'paths' must be a non-empty array of strings.`,
        );
      }
      return input;
    });
  }
  if (args.path !== undefined) {
    if (typeof args.path !== "string" || args.path.trim().length === 0) {
      throw new Error(`${toolName} 'path' must be a non-empty string.`);
    }
    return [args.path];
  }
  return ["."];
}

function commonAncestor(paths: string[]): string {
  let current = paths[0] ?? "/";
  for (const path of paths.slice(1)) {
    while (!isInsideOrSame(current, path)) {
      const parent = dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
  return current;
}

function isInsideOrSame(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

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
