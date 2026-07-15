import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { numberArg } from "../common/args.js";
import {
  boundText,
  FILE_OUTPUT_MAX_LINE_CHARS,
  textBoundaryDetails,
  textLimitSnapshot,
} from "../common/output-budget.js";
import {
  globToRegExp,
  resolveSearchScope,
  type SearchScope,
  walkFiles,
} from "../common/search-utils.js";
import { GREP_MAX_LINE_LENGTH } from "../common/truncate.js";
import { isErrnoException } from "./path.js";

const GREP_TIMEOUT_MS = 30_000;
const STDERR_LIMIT = 64 * 1024;
const BINARY_PROBE_BYTES = 8 * 1024;

type GrepMatch = NonNullable<ToolExecutionResult["matches"]>[number];
type GrepDisplayLine = GrepMatch & { isMatch: boolean };
type GrepRunResult = {
  matches: GrepMatch[];
  lines: GrepDisplayLine[];
};

class RipgrepUnavailableError extends Error {}

export async function executeGrep(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  if (typeof args.pattern !== "string" || args.pattern.length === 0) {
    throw new Error("Tool argument 'pattern' must be a non-empty string.");
  }
  const scope = await resolveSearchScope(context.cwd, args, "grep");
  const limit = Math.min(numberArg(args.limit, 100), 2000);
  const contextLines = numberArg(args.context, 0);
  let raw: GrepRunResult;
  try {
    raw = await runRg(args, scope, limit, contextLines, context.signal);
  } catch (error) {
    if (!(error instanceof RipgrepUnavailableError)) throw error;
    raw = await fallbackGrep(args, scope, limit, contextLines, context.signal);
  }
  const bounded = boundGrepResult(raw);
  const formatted = formatMatches(
    bounded.result,
    limit,
    bounded.truncatedLines,
  );
  return {
    path: scope.displayRoot,
    matches: bounded.result.matches,
    content: formatted.content,
    contentBlocks: [{ type: "text", text: formatted.content }],
    details: formatted.details,
  };
}

async function runRg(
  args: Record<string, unknown>,
  scope: SearchScope,
  limit: number,
  contextLines: number,
  signal: AbortSignal | undefined,
): Promise<GrepRunResult> {
  throwIfSearchAborted(signal);
  const rgArgs = [
    "--json",
    "--line-number",
    "--color=never",
    "--hidden",
    "--with-filename",
    "--max-columns",
    String(FILE_OUTPUT_MAX_LINE_CHARS),
    "--max-columns-preview",
  ];
  if (args.ignoreCase) rgArgs.push("--ignore-case");
  if (args.literal) rgArgs.push("--fixed-strings");
  if (typeof args.glob === "string" && args.glob.length > 0) {
    rgArgs.push("--glob", args.glob);
  }
  if (contextLines > 0) rgArgs.push("--context", String(contextLines));
  rgArgs.push("--", String(args.pattern), ...scope.roots);

  return new Promise<GrepRunResult>((resolve, reject) => {
    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn("rg", rgArgs, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      reject(commandUnavailableError(error));
      return;
    }

    const matches: GrepMatch[] = [];
    const lines: GrepDisplayLine[] = [];
    let stdoutBuffer = "";
    let stderr = "";
    let settled = false;
    let stoppedForLimit = false;
    let finalMatchPath: string | undefined;
    let finalContextLine = 0;
    let processError: Error | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;

    const killChild = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      forceKillTimer ??= setTimeout(() => child.kill("SIGKILL"), 100);
      forceKillTimer.unref();
    };
    const stopAtLimit = () => {
      stoppedForLimit = true;
      killChild();
    };
    const failAndKill = (error: Error) => {
      processError ??= error;
      killChild();
    };
    const onAbort = () => failAndKill(abortError());
    signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(
      () =>
        failAndKill(new Error(`grep timed out after ${GREP_TIMEOUT_MS}ms.`)),
      GREP_TIMEOUT_MS,
    );
    timeout.unref();

    const cleanup = () => {
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", onAbort);
    };
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve({ matches, lines });
    };

    const consumeLine = (line: string) => {
      if (!line) return;
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        failAndKill(
          new Error(
            `ripgrep returned invalid JSON output: ${line.slice(0, 200)}`,
          ),
        );
        return;
      }
      const record = asRecord(event);
      const type = record?.type;
      if (type !== "match" && type !== "context") return;
      const data = asRecord(record?.data);
      const pathData = asRecord(data?.path);
      const linesData = asRecord(data?.lines);
      const pathText = stringValue(pathData?.text);
      const lineNumber = data?.line_number;
      const text = stringValue(linesData?.text)?.replace(/\r?\n$/, "");
      if (!pathText || typeof lineNumber !== "number" || text === undefined) {
        return;
      }
      const displayLine: GrepDisplayLine = {
        path: displayPath(scope.displayRoot, pathText),
        line: lineNumber,
        text,
        isMatch: type === "match",
      };

      if (matches.length < limit) {
        lines.push(displayLine);
        if (displayLine.isMatch) {
          matches.push(stripDisplayFlag(displayLine));
          if (matches.length === limit) {
            finalMatchPath = displayLine.path;
            finalContextLine = displayLine.line + contextLines;
            if (contextLines === 0) stopAtLimit();
          }
        }
        return;
      }

      if (
        displayLine.path === finalMatchPath &&
        displayLine.line <= finalContextLine
      ) {
        lines.push({ ...displayLine, isMatch: false });
        if (displayLine.line >= finalContextLine) stopAtLimit();
        return;
      }
      stopAtLimit();
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      let newline = stdoutBuffer.indexOf("\n");
      while (newline >= 0 && !processError && !stoppedForLimit) {
        const line = stdoutBuffer.slice(0, newline).replace(/\r$/, "");
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        consumeLine(line);
        newline = stdoutBuffer.indexOf("\n");
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < STDERR_LIMIT) {
        stderr += chunk.slice(0, STDERR_LIMIT - stderr.length);
      }
    });
    child.once("error", (error) => {
      processError = commandUnavailableError(error);
    });
    child.once("close", (code) => {
      if (!processError && !stoppedForLimit && stdoutBuffer.trim()) {
        consumeLine(stdoutBuffer.replace(/\r$/, ""));
      }
      if (processError) {
        settle(processError);
        return;
      }
      if (stoppedForLimit || code === 0 || code === 1) {
        settle();
        return;
      }
      const diagnostic = stderr.trim();
      settle(
        new Error(
          diagnostic
            ? `ripgrep failed: ${diagnostic}`
            : `ripgrep exited with code ${code ?? "unknown"}.`,
        ),
      );
    });
  });
}

async function fallbackGrep(
  args: Record<string, unknown>,
  scope: SearchScope,
  limit: number,
  contextLines: number,
  signal: AbortSignal | undefined,
): Promise<GrepRunResult> {
  const matches: GrepMatch[] = [];
  const lines: GrepDisplayLine[] = [];
  const displayIndexes = new Map<string, number>();
  const literal = Boolean(args.literal);
  const ignoreCase = Boolean(args.ignoreCase);
  const pattern = String(args.pattern);
  const regex = literal
    ? undefined
    : new RegExp(pattern, ignoreCase ? "i" : undefined);
  const needle = ignoreCase ? pattern.toLowerCase() : pattern;
  const glob =
    typeof args.glob === "string" ? globToRegExp(args.glob) : undefined;
  const deadline = Date.now() + GREP_TIMEOUT_MS;
  let completedAfterLimit = false;

  const checkExecution = () => {
    throwIfSearchAborted(signal);
    if (Date.now() >= deadline) {
      throw new Error(`grep timed out after ${GREP_TIMEOUT_MS}ms.`);
    }
  };
  const addDisplayLine = (line: GrepDisplayLine) => {
    const key = `${line.path}\0${line.line}`;
    const existingIndex = displayIndexes.get(key);
    if (existingIndex === undefined) {
      displayIndexes.set(key, lines.length);
      lines.push(line);
    } else if (line.isMatch) {
      lines[existingIndex] = line;
    }
  };

  for (const root of scope.roots) {
    await walkFiles(
      scope.displayRoot,
      root,
      limit,
      async (absolutePath, relativePath) => {
        checkExecution();
        const normalizedPath = relativePath.replaceAll("\\", "/");
        if (glob && !glob.test(normalizedPath)) return;
        if (await isBinaryFile(absolutePath)) return;

        const before: Array<{ line: number; text: string }> = [];
        let trailingThrough = 0;
        let lineNumber = 0;
        const input = createReadStream(absolutePath, { encoding: "utf8" });
        const reader = createInterface({ input, crlfDelay: Infinity });
        try {
          for await (const text of reader) {
            checkExecution();
            lineNumber += 1;
            const haystack = ignoreCase ? text.toLowerCase() : text;
            const isMatch = regex
              ? regex.test(text)
              : haystack.includes(needle);
            if (isMatch && matches.length < limit) {
              for (const item of before) {
                addDisplayLine({
                  path: normalizedPath,
                  line: item.line,
                  text: item.text,
                  isMatch: false,
                });
              }
              const match = { path: normalizedPath, line: lineNumber, text };
              matches.push(match);
              addDisplayLine({ ...match, isMatch: true });
              trailingThrough = lineNumber + contextLines;
            } else if (lineNumber <= trailingThrough) {
              addDisplayLine({
                path: normalizedPath,
                line: lineNumber,
                text,
                isMatch: false,
              });
            }

            before.push({ line: lineNumber, text });
            if (before.length > contextLines) before.shift();
            if (matches.length >= limit && lineNumber >= trailingThrough) {
              completedAfterLimit = true;
              input.destroy();
              break;
            }
          }
          if (matches.length >= limit) completedAfterLimit = true;
        } catch (error) {
          if (!isTransientFileError(error)) throw error;
        } finally {
          reader.close();
          input.destroy();
        }
      },
      () => {
        checkExecution();
        return completedAfterLimit;
      },
    );
    if (completedAfterLimit) break;
  }
  return { matches, lines };
}

async function isBinaryFile(path: string): Promise<boolean> {
  let file;
  try {
    file = await open(path, "r");
    const buffer = Buffer.allocUnsafe(BINARY_PROBE_BYTES);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } catch (error) {
    if (isTransientFileError(error)) return true;
    return true;
  } finally {
    await file?.close().catch(() => undefined);
  }
}

function boundGrepResult(result: GrepRunResult): {
  result: GrepRunResult;
  truncatedLines: number;
} {
  let truncatedLines = 0;
  const boundedLines = result.lines.map((line) => {
    const bounded = boundGrepLine(line.text);
    if (bounded.truncated) truncatedLines += 1;
    return { ...line, text: bounded.text };
  });
  const boundedTextByLine = new Map(
    boundedLines
      .filter((line) => line.isMatch)
      .map((line) => [`${line.path}\0${line.line}`, line.text]),
  );
  return {
    result: {
      lines: boundedLines,
      matches: result.matches.map((match) => ({
        ...match,
        text:
          boundedTextByLine.get(`${match.path}\0${match.line}`) ??
          boundGrepLine(match.text).text,
      })),
    },
    truncatedLines,
  };
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
  limit: number,
  truncatedLines: number,
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
  if (result.matches.length >= limit) {
    output.push(
      "",
      `[Match limit ${limit} reached. Increase limit or refine the pattern for more results.]`,
    );
  }
  if (truncatedLines > 0) {
    output.push(
      "",
      `[${truncatedLines} matching line(s) truncated to ${GREP_MAX_LINE_LENGTH} characters. Use read with offset/limit or byteOffset/byteLimit to inspect full lines.]`,
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

function displayPath(displayRoot: string, path: string): string {
  const displayed = isAbsolute(path) ? relative(displayRoot, path) : path;
  return displayed.replaceAll("\\", "/") || path;
}

function stripDisplayFlag(line: GrepDisplayLine): GrepMatch {
  return { path: line.path, line: line.line, text: line.text };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function commandUnavailableError(error: unknown): Error {
  if (
    isErrnoException(error) &&
    (error.code === "ENOENT" || error.code === "EACCES")
  ) {
    return new RipgrepUnavailableError(error.message);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function isTransientFileError(error: unknown): boolean {
  return (
    isErrnoException(error) &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function throwIfSearchAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): Error {
  const error = new Error("grep execution aborted.");
  error.name = "AbortError";
  return error;
}
