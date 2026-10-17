import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { spawnManagedChildProcess } from "@nervekit/native";
import { searchProcessPolicy } from "../process/managed-process-policy.js";
import { stat } from "node:fs/promises";
import { relative } from "node:path";
import type {
  FilesystemExecutionContext,
  ToolExecutionResult,
} from "../execution-context.js";
import { numberArg } from "../process/arguments.js";
import {
  boundText,
  FILE_OUTPUT_MAX_LINE_CHARS,
  textBoundaryDetails,
  textLimitSnapshot,
} from "../output/output-budget.js";
import { globToRegExp, walkFiles } from "./search-utils.js";
import {
  isErrnoException,
  pathNotFoundMessage,
  resolveToolPath,
} from "./path.js";

type FindRunResult = { paths: string[]; totalEntries: number };

type FindBackendMode = "auto" | "fd" | "node";

export async function executeFind(
  args: Record<string, unknown>,
  context: FilesystemExecutionContext,
): Promise<ToolExecutionResult> {
  return executeFindWithBackend(args, context, "auto");
}

/** Internal deterministic seam for semantic tests and development benchmarks. */
export async function executeFindWithBackend(
  args: Record<string, unknown>,
  context: FilesystemExecutionContext,
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
  let found: FindRunResult;
  if (backendMode === "node") {
    found = await fallbackFind(root, args.pattern, limit, context.signal);
  } else if (backendMode === "fd") {
    found = await runFd(args.pattern, root, limit, context.signal);
  } else {
    const fd = await runFd(args.pattern, root, limit, context.signal).catch(
      (error: unknown) => {
        if (
          isErrnoException(error) &&
          (error.code === "ENOENT" ||
            (error.code === "GenericFailure" &&
              /no such file|not found/i.test(error.message)))
        ) {
          return undefined;
        }
        throw error;
      },
    );
    found =
      fd ?? (await fallbackFind(root, args.pattern, limit, context.signal));
  }
  const { paths, totalEntries } = found;
  const entries = paths
    .slice(0, limit)
    .map((path) => ({ path, kind: "file" as const }));
  const formatted = formatFind(paths, limit, totalEntries);
  return {
    path: root,
    entries,
    content: formatted.content,
    contentBlocks: [{ type: "text", text: formatted.content }],
    details: {
      totalEntries,
      ...(formatted.details && typeof formatted.details === "object"
        ? formatted.details
        : {}),
      returnedEntries: entries.length,
      producerLimitReached: totalEntries >= limit,
    },
  };
}

async function runFd(
  pattern: string,
  root: string,
  limit: number,
  signal?: AbortSignal,
): Promise<FindRunResult> {
  const fdArgs = [
    "--hidden",
    "--glob",
    "--type",
    "file",
    "--color=never",
    "--no-require-git",
  ];
  let effectivePattern = pattern;
  if (pattern.includes("/")) {
    fdArgs.push("--full-path");
    if (!pattern.startsWith("/") && !pattern.startsWith("**/")) {
      effectivePattern = `**/${pattern}`;
    }
  }
  fdArgs.push("--", effectivePattern, root);
  signal?.throwIfAborted();
  return new Promise<FindRunResult>((resolve, reject) => {
    const child = spawnManagedChildProcess("fd", fdArgs, {
      policy: searchProcessPolicy(),
    }) as ChildProcessByStdio<null, Readable, Readable>;
    const paths: string[] = [];
    let totalEntries = 0;
    let pending = "";
    let stderr = "";
    let failure: unknown;
    let forceKill: NodeJS.Timeout | undefined;
    const fail = (error: unknown) => {
      failure ??= error;
      child.kill("SIGTERM");
      forceKill ??= setTimeout(() => child.kill("SIGKILL"), 100);
      forceKill.unref();
    };
    const abort = () => fail(signal?.reason ?? new Error("find aborted"));
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(
      () => fail(new Error("find timed out after 30000ms.")),
      30_000,
    );
    timeout.unref();
    const consume = (line: string) => {
      const path = line.trim();
      if (!path) return;
      totalEntries += 1;
      if (paths.length < limit)
        paths.push((relative(root, path) || path).replaceAll("\\", "/"));
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      pending += chunk;
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        consume(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
      }
      if (pending.length > 1024 * 1024)
        fail(new Error("fd returned an oversized path."));
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk.slice(0, Math.max(0, 64 * 1024 - stderr.length));
    });
    child.once("error", (error) => {
      failure = error;
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      signal?.removeEventListener("abort", abort);
      if (failure) {
        reject(failure);
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            stderr.trim() || `fd exited with code ${code ?? "unknown"}.`,
          ),
        );
        return;
      }
      consume(pending);
      resolve({ paths, totalEntries });
    });
  });
}

async function fallbackFind(
  root: string,
  pattern: string,
  limit: number,
  signal?: AbortSignal,
): Promise<FindRunResult> {
  const deadline = Date.now() + 30_000;
  const checkExecution = () => {
    signal?.throwIfAborted();
    if (Date.now() >= deadline)
      throw new Error("find timed out after 30000ms.");
    return false;
  };
  let totalEntries = 0;
  const results: string[] = [];
  const regex = globToRegExp(pattern);
  await walkFiles(
    root,
    root,
    limit,
    async (_absolutePath, relativePath) => {
      const normalizedPath = relativePath.replaceAll("\\", "/");
      if (regex.test(normalizedPath)) {
        totalEntries += 1;
        if (results.length < limit) results.push(normalizedPath);
      }
    },
    checkExecution,
  );
  return { paths: results, totalEntries };
}

function formatFind(
  paths: string[],
  limit: number,
  totalEntries: number,
): {
  content: string;
  details?: unknown;
} {
  const lines = paths.slice(0, limit);
  if (lines.length === 0) lines.push("No files found.");
  if (totalEntries >= limit) {
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
