import { files } from "@nervekit/native";
import { stat } from "node:fs/promises";
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
import { searchError } from "./search-utils.js";
import {
  isErrnoException,
  notDirectoryMessage,
  pathNotFoundMessage,
  resolveToolPath,
} from "./path.js";

const FIND_TIMEOUT_MS = 30_000;

export async function executeFind(
  args: Record<string, unknown>,
  context: FilesystemExecutionContext,
): Promise<ToolExecutionResult> {
  if (typeof args.pattern !== "string" || args.pattern.length === 0) {
    throw new Error("Tool argument 'pattern' must be a non-empty string.");
  }
  const input =
    typeof args.path === "string" && args.path.trim().length === 0
      ? "."
      : (args.path ?? ".");
  const root = resolveToolPath(context.cwd, input);
  const info = await stat(root).catch(async (error: unknown) => {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new Error(await pathNotFoundMessage(input, root, true));
    }
    throw error;
  });
  if (!info.isDirectory())
    throw new Error(notDirectoryMessage(input, root, info.isFile()));
  const limit = Math.min(numberArg(args.limit, 1000), 5000);
  let found: files.FindFilesResult;
  try {
    found = await files.findFiles(root, {
      pattern: args.pattern,
      limit,
      timeoutMs: FIND_TIMEOUT_MS,
      signal: context.signal,
    });
  } catch (error) {
    throw searchError(error, "find", FIND_TIMEOUT_MS, context.signal);
  }
  const { paths, total: totalEntries } = found;
  const entries = paths.map((path) => ({ path, kind: "file" as const }));
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
  if (totalEntries > lines.length && paths.length > 0) {
    lines.push(
      "",
      `Showing ${lines.length} of ${totalEntries} files. Narrow with path or a tighter pattern.`,
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
