import { files } from "@nervekit/native";
import { stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, sep } from "node:path";
import {
  isErrnoException,
  pathNotFoundMessage,
  resolveToolPath,
} from "./path.js";

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
    const info = await stat(path).catch(async (error: unknown) => {
      if (isErrnoException(error) && error.code === "ENOENT") {
        throw new Error(await pathNotFoundMessage(input, path, true));
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
    if (typeof args.path !== "string") {
      throw new Error(`${toolName} 'path' must be a string.`);
    }
    return [args.path.trim().length === 0 ? "." : args.path];
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
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  );
}

/**
 * Maps a native search failure to the tool's error: the abort error, the
 * timeout message, or a pattern/glob diagnostic the model can act on.
 */
export function searchError(
  error: unknown,
  tool: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Error {
  if (signal?.aborted) {
    const aborted = new Error(`${tool} execution aborted.`);
    aborted.name = "AbortError";
    return aborted;
  }
  if (error instanceof files.SearchTimeoutError)
    return new Error(`${tool} timed out after ${timeoutMs}ms.`);
  if (error instanceof Error) {
    const pattern = /^INVALID_SEARCH_PATTERN:(\d*):(.*)$/s.exec(error.message);
    if (pattern)
      return new Error(
        `Invalid ${tool} pattern: ${pattern[2]}${pattern[1] ? ` (column ${pattern[1]})` : ""}.`,
      );
    return error;
  }
  return new Error(String(error));
}
