import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { relative } from "node:path";
import { promisify } from "node:util";
import type { ToolExecutionContext, ToolExecutionResult } from "../types.js";
import { numberArg } from "./common.js";
import {
  isErrnoException,
  pathNotFoundMessage,
  resolveToolPath,
} from "./path.js";
import { globToRegExp, walkFiles } from "./search-utils.js";
import { truncateHead } from "./truncate.js";

const execFileAsync = promisify(execFile);

export async function executeFind(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  if (typeof args.pattern !== "string" || args.pattern.length === 0) {
    throw new Error("Tool argument 'pattern' must be a non-empty string.");
  }
  const input = args.path ?? ".";
  const root = resolveToolPath(context.cwd, input);
  await stat(root).catch((error: unknown) => {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new Error(pathNotFoundMessage("find", input, root));
    }
    throw error;
  });
  const limit = Math.min(numberArg(args.limit, 1000), 5000);
  const fd = await runFd(args.pattern, root, limit).catch(() => undefined);
  const paths = fd ?? (await fallbackFind(root, args.pattern, limit));
  const entries = paths
    .slice(0, limit)
    .map((path) => ({ path, kind: "file" as const }));
  const formatted = formatFind(paths, limit);
  return {
    path: root,
    entries,
    content: formatted.content,
    contentBlocks: [{ type: "text", text: formatted.content }],
    details: formatted.details,
  };
}

async function runFd(
  pattern: string,
  root: string,
  limit: number,
): Promise<string[]> {
  const fdArgs = [
    "--hidden",
    "--glob",
    "--type",
    "file",
    "--color=never",
    "--no-require-git",
    "--max-results",
    String(limit),
  ];
  let effectivePattern = pattern;
  if (pattern.includes("/")) {
    fdArgs.push("--full-path");
    if (!pattern.startsWith("/") && !pattern.startsWith("**/")) {
      effectivePattern = `**/${pattern}`;
    }
  }
  fdArgs.push("--", effectivePattern, root);
  const { stdout } = await execFileAsync("fd", fdArgs, {
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((path) => (relative(root, path) || path).replaceAll("\\", "/"));
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
      if (regex.test(relativePath))
        results.push(relativePath.replaceAll("\\", "/"));
    },
    () => results.length >= limit,
  );
  return results;
}

function formatFind(
  paths: string[],
  limit: number,
): {
  content: string;
  details?: unknown;
} {
  const lines = paths.slice(0, limit);
  if (lines.length === 0) lines.push("No files found.");
  if (paths.length >= limit) {
    lines.push(
      "",
      `[Result limit ${limit} reached. Increase limit or refine the pattern for more results.]`,
    );
  }
  const truncated = truncateHead(lines.join("\n"), {
    maxLines: Number.MAX_SAFE_INTEGER,
  });
  return {
    content: truncated.text,
    details: truncated.truncated ? { truncation: truncated } : undefined,
  };
}
