import { files } from "@nervekit/native";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
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
import {
  resolveSearchScope,
  searchError,
  type SearchScope,
} from "./search-utils.js";
import { GREP_MAX_LINE_LENGTH } from "../output/truncate.js";

const GREP_TIMEOUT_MS = 30_000;

type GrepMatch = NonNullable<ToolExecutionResult["matches"]>[number];
type GrepDisplayLine = GrepMatch & { isMatch: boolean };
type GrepRunResult = {
  matches: GrepMatch[];
  lines: GrepDisplayLine[];
  totalMatches: number;
  totalFiles: number;
};

export async function executeGrep(
  args: Record<string, unknown>,
  context: FilesystemExecutionContext,
): Promise<ToolExecutionResult> {
  if (typeof args.pattern !== "string" || args.pattern.length === 0) {
    throw new Error("Tool argument 'pattern' must be a non-empty string.");
  }
  const scope = await resolveSearchScope(context.cwd, args, "grep");
  const limit = Math.min(numberArg(args.limit, 100), 2000);
  const contextLines = Math.max(0, Math.floor(numberArg(args.context, 0)));
  const raw = await runGrep(args, scope, limit, contextLines, context.signal);
  const bounded = boundGrepResult(raw);
  const longLine = bounded.firstTruncated
    ? await longLineReadHint(
        context.cwd,
        scope.displayRoot,
        bounded.firstTruncated,
      )
    : undefined;
  const formatted = formatMatches(
    bounded.result,
    bounded.truncatedLines,
    longLine,
  );
  return {
    path: scope.displayRoot,
    matches: bounded.result.matches,
    content: formatted.content,
    contentBlocks: [{ type: "text", text: formatted.content }],
    details: {
      totalMatches: raw.totalMatches,
      totalFiles: raw.totalFiles,
      ...(formatted.details && typeof formatted.details === "object"
        ? formatted.details
        : {}),
      returnedMatches: bounded.result.matches.length,
      producerLimitReached: bounded.result.matches.length >= limit,
    },
  };
}

type TruncatedGrepLine = { path: string; line: number; text: string };

function boundGrepResult(result: GrepRunResult): {
  result: GrepRunResult;
  truncatedLines: number;
  firstTruncated?: TruncatedGrepLine;
} {
  let truncatedLines = 0;
  let firstTruncated: TruncatedGrepLine | undefined;
  const boundedLines = result.lines.map((line) => {
    const bounded = boundGrepLine(line.text);
    if (bounded.truncated) {
      truncatedLines += 1;
      firstTruncated ??= { path: line.path, line: line.line, text: line.text };
    }
    return { ...line, text: bounded.text };
  });
  const boundedTextByLine = new Map(
    boundedLines
      .filter((line) => line.isMatch)
      .map((line) => [`${line.path}\0${line.line}`, line.text]),
  );
  return {
    result: {
      totalMatches: result.totalMatches,
      totalFiles: result.totalFiles,
      lines: boundedLines,
      matches: result.matches.map((match) => ({
        ...match,
        text:
          boundedTextByLine.get(`${match.path}\0${match.line}`) ??
          boundGrepLine(match.text).text,
      })),
    },
    truncatedLines,
    firstTruncated,
  };
}

/**
 * A copyable `read` call for the part of the first cut line that grep did not show,
 * or undefined when the file cannot be read or is too large to scan.
 */
async function longLineReadHint(
  cwd: string,
  displayRoot: string,
  cut: TruncatedGrepLine,
): Promise<string | undefined> {
  const absolute = resolve(displayRoot, cut.path);
  try {
    if ((await stat(absolute)).size > 64 * 1024 * 1024) return undefined;
    const buffer = await readFile(absolute);
    let start = 0;
    for (let line = 1; line < cut.line; line += 1) {
      const newline = buffer.indexOf(0x0a, start);
      if (newline < 0) return undefined;
      start = newline + 1;
    }
    const shown = Buffer.byteLength(cut.text.slice(0, GREP_MAX_LINE_LENGTH));
    const fromCwd = relative(cwd, absolute).split(sep).join("/");
    const path =
      fromCwd &&
      fromCwd !== ".." &&
      !fromCwd.startsWith("../") &&
      !isAbsolute(fromCwd)
        ? fromCwd
        : absolute;
    return JSON.stringify({ path, byteOffset: start + shown });
  } catch {
    return undefined;
  }
}

function boundGrepLine(text: string) {
  return boundText(text, {
    maxLines: 1,
    maxBytes: FILE_OUTPUT_MAX_LINE_CHARS,
    maxLineChars: GREP_MAX_LINE_LENGTH,
  });
}

function formatMatches(
  result: GrepRunResult,
  truncatedLines: number,
  longLineHint: string | undefined,
): {
  content: string;
  details?: unknown;
} {
  const output: string[] = [];
  let previous: GrepDisplayLine | undefined;
  for (const line of result.lines) {
    if (
      previous &&
      (previous.path !== line.path || previous.line + 1 !== line.line)
    ) {
      output.push("--");
    }
    output.push(
      line.isMatch
        ? `${line.path}:${line.line}: ${line.text}`
        : `${line.path}-${line.line}- ${line.text}`,
    );
    previous = line;
  }
  if (result.matches.length === 0) output.push("No matches found.");
  if (result.totalMatches > result.matches.length) {
    output.push(
      "",
      `Showing ${result.matches.length} of ${result.totalMatches} matches. Narrow with path, glob or a tighter pattern.`,
    );
  }
  if (truncatedLines > 0) {
    output.push(
      "",
      `${truncatedLines} line${truncatedLines === 1 ? "" : "s"} cut to ${GREP_MAX_LINE_LENGTH} chars.${longLineHint ? ` Next: read ${longLineHint}` : ""}`,
    );
  }
  const bounded = boundText(output.join("\n"), {
    maxLines: Number.MAX_SAFE_INTEGER,
    maxLineChars: FILE_OUTPUT_MAX_LINE_CHARS,
  });
  return {
    content: bounded.text,
    details:
      bounded.truncated || truncatedLines > 0
        ? {
            truncation: textBoundaryDetails(bounded),
            truncatedLines,
            outputLimits: {
              execution: {
                ...textLimitSnapshot(bounded),
                truncated: bounded.truncated || truncatedLines > 0,
                truncatedLines,
              },
            },
          }
        : undefined,
  };
}

function stripDisplayFlag(line: GrepDisplayLine): GrepMatch {
  return { path: line.path, line: line.line, text: line.text };
}

async function runGrep(
  args: Record<string, unknown>,
  scope: SearchScope,
  limit: number,
  contextLines: number,
  signal: AbortSignal | undefined,
): Promise<GrepRunResult> {
  let result: files.GrepResult;
  try {
    result = await files.grep(scope.displayRoot, scope.roots, {
      pattern: args.pattern as string,
      literal: Boolean(args.literal),
      ignoreCase: Boolean(args.ignoreCase),
      glob: typeof args.glob === "string" ? args.glob : undefined,
      context: contextLines,
      limit,
      maxLineBytes: FILE_OUTPUT_MAX_LINE_CHARS,
      timeoutMs: GREP_TIMEOUT_MS,
      signal,
    });
  } catch (error) {
    throw searchError(error, "grep", GREP_TIMEOUT_MS, signal);
  }
  const lines: GrepDisplayLine[] = result.lines;
  return {
    lines,
    matches: lines.filter((line) => line.isMatch).map(stripDisplayFlag),
    totalMatches: result.totalMatches,
    totalFiles: result.totalFiles,
  };
}
