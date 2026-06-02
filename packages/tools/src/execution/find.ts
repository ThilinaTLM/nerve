import { execFile } from "node:child_process";
import { relative } from "node:path";
import { promisify } from "node:util";
import type { ToolExecutionContext, ToolExecutionResult } from "../types.js";
import { numberArg } from "./common.js";
import { resolveToolPath } from "./path.js";
import { globToRegExp, walkFiles } from "./search-utils.js";

const execFileAsync = promisify(execFile);

export async function executeFind(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  if (typeof args.pattern !== "string" || args.pattern.length === 0) {
    throw new Error("Tool argument 'pattern' must be a non-empty string.");
  }
  const root = resolveToolPath(context.cwd, args.path ?? ".");
  const limit = Math.min(numberArg(args.limit, 1000), 5000);
  const fd = await runFd(args.pattern, root, limit).catch(() => undefined);
  const paths = fd ?? (await fallbackFind(root, args.pattern, limit));
  return {
    path: root,
    entries: paths.slice(0, limit).map((path) => ({ path, kind: "file" })),
  };
}

async function runFd(
  pattern: string,
  root: string,
  limit: number,
): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "fd",
    [
      "--hidden",
      "--glob",
      "--type",
      "file",
      "--max-results",
      String(limit),
      "--",
      pattern,
      root,
    ],
    { timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((path) => relative(root, path) || path);
}

async function fallbackFind(
  root: string,
  pattern: string,
  limit: number,
): Promise<string[]> {
  const results: string[] = [];
  const regex = globToRegExp(pattern);
  await walkFiles(
    root,
    root,
    limit,
    async (_absolutePath, relativePath) => {
      if (regex.test(relativePath)) results.push(relativePath);
    },
    () => results.length >= limit,
  );
  return results;
}
