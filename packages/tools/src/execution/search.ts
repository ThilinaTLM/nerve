import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { promisify } from "node:util";
import type { ToolExecutionContext, ToolExecutionResult } from "../types.js";
import { numberArg } from "./common.js";
import { resolveToolPath } from "./path.js";
import { globToRegExp, walkFiles } from "./search-utils.js";

const execFileAsync = promisify(execFile);

export async function executeGrep(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  if (typeof args.pattern !== "string" || args.pattern.length === 0) {
    throw new Error("Tool argument 'pattern' must be a non-empty string.");
  }
  const root = resolveToolPath(context.cwd, args.path ?? ".");
  const limit = Math.min(numberArg(args.limit, 100), 2000);
  const rg = await runRg(args, root, limit).catch(() => undefined);
  const matches = rg ?? (await fallbackGrep(args, root, limit));
  return { path: root, matches: matches.slice(0, limit) };
}

async function runRg(
  args: Record<string, unknown>,
  root: string,
  limit: number,
): Promise<NonNullable<ToolExecutionResult["matches"]>> {
  const rgArgs = ["--line-number", "--color=never", "--hidden"];
  if (args.ignoreCase) rgArgs.push("--ignore-case");
  if (args.literal) rgArgs.push("--fixed-strings");
  if (typeof args.glob === "string" && args.glob.length > 0) {
    rgArgs.push("--glob", args.glob);
  }
  const contextLines = numberArg(args.context, 0);
  if (contextLines > 0) rgArgs.push("--context", String(contextLines));
  rgArgs.push("--", String(args.pattern), root);
  const { stdout } = await execFileAsync("rg", rgArgs, {
    timeout: 30_000,
    maxBuffer: 1024 * 1024 * 4,
  });
  const matches: NonNullable<ToolExecutionResult["matches"]> = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue;
    const match = /^(.*?):(\d+):(.*)$/.exec(line);
    if (!match) continue;
    matches.push({
      path: relative(root, match[1] ?? "") || (match[1] ?? ""),
      line: Number(match[2]),
      text: match[3] ?? "",
    });
    if (matches.length >= limit) break;
  }
  return matches;
}

async function fallbackGrep(
  args: Record<string, unknown>,
  root: string,
  limit: number,
): Promise<NonNullable<ToolExecutionResult["matches"]>> {
  const matches: NonNullable<ToolExecutionResult["matches"]> = [];
  const literal = Boolean(args.literal);
  const ignoreCase = Boolean(args.ignoreCase);
  const pattern = String(args.pattern);
  const regex = literal
    ? undefined
    : new RegExp(pattern, ignoreCase ? "i" : undefined);
  const needle = ignoreCase ? pattern.toLowerCase() : pattern;
  const glob =
    typeof args.glob === "string" ? globToRegExp(args.glob) : undefined;
  await walkFiles(
    root,
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
          matches.push({ path: relativePath, line: index + 1, text: line });
          if (matches.length >= limit) return;
        }
      }
    },
    () => matches.length >= limit,
  );
  return matches;
}
