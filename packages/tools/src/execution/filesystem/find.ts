import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { ExecutionWorkerClient } from "@nervekit/native";
import { stat } from "node:fs/promises";
import { relative } from "node:path";
import { promisify } from "node:util";
import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { numberArg } from "../common/args.js";
import {
  boundText,
  FILE_OUTPUT_MAX_LINE_CHARS,
  textBoundaryDetails,
  textLimitSnapshot,
} from "../common/output-budget.js";
import { globToRegExp, walkFiles } from "../common/search-utils.js";
import {
  isErrnoException,
  pathNotFoundMessage,
  resolveToolPath,
} from "./path.js";

const execFileAsync = promisify(execFile);

type FindBackendMode = "auto" | "fd" | "node";

export async function executeFind(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  return executeFindWithBackend(args, context, "auto");
}

/** Internal deterministic seam for semantic tests and development benchmarks. */
export async function executeFindWithBackend(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  backendMode: FindBackendMode,
): Promise<ToolExecutionResult> {
  if (typeof args.pattern !== "string" || args.pattern.length === 0) {
    throw new Error("Tool argument 'pattern' must be a non-empty string.");
  }
  const input =
    typeof args.path === "string" && args.path.trim().length === 0
      ? "."
      : (args.path ?? ".");
  const root = resolveToolPath(context.cwd, input);
  const info = await stat(root).catch((error: unknown) => {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new Error(pathNotFoundMessage("find", input, root));
    }
    throw error;
  });
  if (!info.isDirectory()) throw new Error("find path is not a directory.");
  const limit = Math.min(numberArg(args.limit, 1000), 5000);
  let paths: string[];
  if (backendMode === "node") {
    paths = await fallbackFind(root, args.pattern, limit);
  } else if (backendMode === "fd") {
    paths = await runFd(
      args.pattern,
      root,
      limit,
      context.dataDir,
      context.executionId,
    );
  } else {
    const fd = await runFd(
      args.pattern,
      root,
      limit,
      context.dataDir,
      context.executionId,
    ).catch((error: unknown) => {
      if (
        (isErrnoException(error) && error.code === "ENOENT") ||
        (error instanceof Error &&
          /not found|no such file/i.test(error.message))
      ) {
        return undefined;
      }
      throw error;
    });
    paths = fd ?? (await fallbackFind(root, args.pattern, limit));
  }
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
  executionHome?: string,
  durableExecutionId?: string,
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
  let stdout: string;
  if (executionHome) {
    const client = await ExecutionWorkerClient.connect(executionHome);
    const executionId = durableExecutionId ?? `find_${randomUUID()}`;
    const chunks: Buffer[] = [];
    try {
      await client.start({
        executionId,
        command: "fd",
        args: fdArgs,
        timeoutMs: 30_000,
        terminationGraceMs: 100,
        belowNormalPriority: true,
      });
      const terminal = await client.subscribe(executionId, {
        onOutput: (stream, chunk) => {
          if (stream === "stdout") chunks.push(chunk);
        },
      }).settled;
      stdout = Buffer.concat(chunks).toString("utf8");
      if (terminal.exitCode !== 0) throw new Error("fd failed");
    } finally {
      if (!durableExecutionId) {
        void client.remove(executionId).catch(() => undefined);
      }
    }
  } else {
    ({ stdout } = await execFileAsync("fd", fdArgs, {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    }));
  }
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
      const normalizedPath = relativePath.replaceAll("\\", "/");
      if (regex.test(normalizedPath)) results.push(normalizedPath);
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
  const bounded = boundText(lines.join("\n"), {
    maxLines: Number.MAX_SAFE_INTEGER,
    maxLineChars: FILE_OUTPUT_MAX_LINE_CHARS,
  });
  return {
    content: bounded.text,
    details: bounded.truncated
      ? {
          truncation: textBoundaryDetails(bounded),
          outputLimits: { execution: textLimitSnapshot(bounded) },
        }
      : undefined,
  };
}
