import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { promisify } from "node:util";
import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { numberArg } from "../common/args.js";
import {
  globToRegExp,
  resolveSearchScope,
  type SearchScope,
  walkFiles,
} from "../common/search-utils.js";
import { truncateHead, truncateLine } from "../common/truncate.js";

const execFileAsync = promisify(execFile);

type GrepMatch = NonNullable<ToolExecutionResult["matches"]>[number];

export async function executeGrep(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  if (typeof args.pattern !== "string" || args.pattern.length === 0) {
    throw new Error("Tool argument 'pattern' must be a non-empty string.");
  }
  const scope = await resolveSearchScope(context.cwd, args, "grep");
  const limit = Math.min(numberArg(args.limit, 100), 2000);
  const rg = await runRg(args, scope, limit).catch(() => undefined);
  const matches = rg ?? (await fallbackGrep(args, scope, limit));
  const formatted = formatMatches(matches, limit);
  return {
    path: scope.displayRoot,
    matches: matches.slice(0, limit),
    content: formatted.content,
    contentBlocks: [{ type: "text", text: formatted.content }],
    details: formatted.details,
  };
}

async function runRg(
  args: Record<string, unknown>,
  scope: SearchScope,
  limit: number,
): Promise<GrepMatch[]> {
  const rgArgs = [
    "--line-number",
    "--color=never",
    "--hidden",
    "--with-filename",
  ];
  if (args.ignoreCase) rgArgs.push("--ignore-case");
  if (args.literal) rgArgs.push("--fixed-strings");
  if (typeof args.glob === "string" && args.glob.length > 0) {
    rgArgs.push("--glob", args.glob);
  }
  const contextLines = numberArg(args.context, 0);
  if (contextLines > 0) rgArgs.push("--context", String(contextLines));
  rgArgs.push("--", String(args.pattern), ...scope.roots);
  const { stdout } = await execFileAsync("rg", rgArgs, {
    timeout: 30_000,
    maxBuffer: 1024 * 1024 * 4,
  });
  const matches: GrepMatch[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue;
    const match = /^(.*?):(\d+):(.*)$/.exec(line);
    if (!match) continue;
    matches.push({
      path:
        relative(scope.displayRoot, match[1] ?? "").replaceAll("\\", "/") ||
        (match[1] ?? ""),
      line: Number(match[2]),
      text: match[3] ?? "",
    });
    if (matches.length >= limit) break;
  }
  return matches;
}

async function fallbackGrep(
  args: Record<string, unknown>,
  scope: SearchScope,
  limit: number,
): Promise<GrepMatch[]> {
  const matches: GrepMatch[] = [];
  const literal = Boolean(args.literal);
  const ignoreCase = Boolean(args.ignoreCase);
  const pattern = String(args.pattern);
  const regex = literal
    ? undefined
    : new RegExp(pattern, ignoreCase ? "i" : undefined);
  const needle = ignoreCase ? pattern.toLowerCase() : pattern;
  const glob =
    typeof args.glob === "string" ? globToRegExp(args.glob) : undefined;

  for (const root of scope.roots) {
    await walkFiles(
      scope.displayRoot,
      root,
      limit,
      async (absolutePath, relativePath) => {
        if (glob && !glob.test(relativePath)) return;
        const info = await stat(absolutePath);
        if (info.size > 1024 * 1024) return;
        const content = await readFile(absolutePath, "utf8").catch(
          () => undefined,
        );
        if (content === undefined) return;
        const lines = content.split(/\r?\n/);
        for (const [index, line] of lines.entries()) {
          const haystack = ignoreCase ? line.toLowerCase() : line;
          if (regex ? regex.test(line) : haystack.includes(needle)) {
            matches.push({
              path: relativePath.replaceAll("\\", "/"),
              line: index + 1,
              text: line,
            });
            if (matches.length >= limit) return;
          }
        }
      },
      () => matches.length >= limit,
    );
    if (matches.length >= limit) break;
  }
  return matches;
}

function formatMatches(
  matches: GrepMatch[],
  limit: number,
): {
  content: string;
  details?: unknown;
} {
  let truncatedLines = 0;
  const lines = matches.slice(0, limit).map((match) => {
    const text = truncateLine(match.text);
    if (text.truncated) truncatedLines += 1;
    return `${match.path}:${match.line}: ${text.text}`;
  });
  if (matches.length === 0) lines.push("No matches found.");
  if (matches.length >= limit) {
    lines.push(
      ``,
      `[Match limit ${limit} reached. Increase limit or refine the pattern for more results.]`,
    );
  }
  if (truncatedLines > 0) {
    lines.push(
      ``,
      `[${truncatedLines} matching line(s) truncated to 500 characters. Use read to inspect full lines.]`,
    );
  }
  const truncated = truncateHead(lines.join("\n"), {
    maxLines: Number.MAX_SAFE_INTEGER,
  });
  return {
    content: truncated.text,
    details:
      truncated.truncated || truncatedLines > 0
        ? { truncation: truncated, truncatedLines }
        : undefined,
  };
}
