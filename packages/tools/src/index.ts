import { exec, execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { ToolDescriptor, ToolName, ToolRisk } from "@nerve/shared";
import {
  coreToolDescriptorsFromDefinitions,
  coreToolRiskForName,
} from "./definitions.js";

export * from "./definitions.js";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export const coreToolDescriptors: ToolDescriptor[] =
  coreToolDescriptorsFromDefinitions();

export type ToolExecutionContext = {
  cwd: string;
};

export type ToolExecutionResult = {
  content?: string;
  path?: string;
  entries?: Array<{ path: string; kind: "file" | "directory" | "other" }>;
  matches?: Array<{ path: string; line: number; text: string }>;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
};

export type ToolPathArgs = {
  path?: unknown;
};

export type ReadToolArgs = ToolPathArgs & {
  offset?: unknown;
  limit?: unknown;
};

export type WriteToolArgs = ToolPathArgs & {
  content?: unknown;
};

export type EditToolArgs = ToolPathArgs & {
  edits?: unknown;
  oldText?: unknown;
  newText?: unknown;
};

export type BashToolArgs = {
  command?: unknown;
  timeout?: unknown;
};

export type LsToolArgs = ToolPathArgs & {
  limit?: unknown;
};

export type FindToolArgs = ToolPathArgs & {
  pattern?: unknown;
  limit?: unknown;
};

export type GrepToolArgs = ToolPathArgs & {
  pattern?: unknown;
  glob?: unknown;
  ignoreCase?: unknown;
  literal?: unknown;
  context?: unknown;
  limit?: unknown;
};

export function toolRiskForName(name: ToolName): ToolRisk {
  return coreToolRiskForName(name);
}

export function hasShellControlOperator(command: string): boolean {
  return /[><|`$();]/.test(command) || command.includes("&&") || command.includes("||");
}

export function isKnownReadOnlyCommand(command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (!normalized || hasShellControlOperator(normalized)) return false;
  const first = normalized.split(" ")[0];
  if (["pwd", "ls", "find", "rg", "grep", "which", "cat"].includes(first))
    return true;
  if (normalized === "git status" || normalized.startsWith("git status "))
    return true;
  if (normalized === "git diff" || normalized.startsWith("git diff "))
    return true;
  if (normalized === "git log" || normalized.startsWith("git log "))
    return true;
  if (normalized === "git show" || normalized.startsWith("git show "))
    return true;
  return false;
}

export function hasDangerousCommandPattern(command: string): boolean {
  return /(^|\s)(rm\s+-rf|sudo|mkfs|dd\s+if=|chmod\s+-R|chown\s+-R|git\s+reset\s+--hard|git\s+clean\s+-fd|docker\s+system\s+prune|kubectl\s+delete)(\s|$)/.test(
    command,
  );
}

export function isLikelyLongRunningCommand(command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (!normalized) return false;
  return (
    /(^|\s)(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|preview|watch)(\s|$)/.test(
      normalized,
    ) ||
    /(^|\s)(vite|next\s+dev|svelte-kit\s+dev|astro\s+dev|webpack\s+serve|nodemon|tsx\s+watch|tsc\s+--watch|cargo\s+watch)(\s|$)/.test(
      normalized,
    )
  );
}

export async function executeTool(
  name: ToolName,
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  switch (name) {
    case "read":
      return executeRead(args, context);
    case "bash":
      return executeBash(args, context);
    case "edit":
      return executeEdit(args, context);
    case "write":
      return executeWrite(args, context);
    case "grep":
      return executeGrep(args, context);
    case "find":
      return executeFind(args, context);
    case "ls":
      return executeLs(args, context);
    case "process_start":
    case "process_stop":
    case "process_restart":
    case "process_list":
    case "process_logs":
      throw new Error(`${name} is executed by the orchestrator process manager.`);
    case "subagent_run":
      throw new Error(`${name} is executed by the orchestrator agent runtime.`);
  }
}

export function resolveToolPath(cwd: string, input: unknown): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error("Tool argument 'path' must be a non-empty string.");
  }
  return resolve(cwd, input);
}

async function executeRead(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const path = resolveToolPath(context.cwd, args.path);
  const content = await readFile(path, "utf8");
  const lines = content.split(/\r?\n/);
  const offset = numberArg(args.offset, 1);
  const limit = Math.min(numberArg(args.limit, 1000), 5000);
  const selected = lines
    .slice(Math.max(0, offset - 1), Math.max(0, offset - 1) + limit)
    .join("\n");
  const remaining = Math.max(0, lines.length - (offset - 1 + limit));
  return {
    path,
    content:
      remaining > 0
        ? `${selected}\n\n[...${remaining} more lines. Continue with offset ${offset + limit}.]`
        : selected,
  };
}

async function executeWrite(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const path = resolveToolPath(context.cwd, args.path);
  if (typeof args.content !== "string")
    throw new Error("Tool argument 'content' must be a string.");
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, args.content, "utf8");
  await rename(tempPath, path);
  return {
    path,
    content: `Wrote ${Buffer.byteLength(args.content, "utf8")} bytes.`,
  };
}

async function executeEdit(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const path = resolveToolPath(context.cwd, args.path);
  const edits = normalizeEditOperations(args);
  const content = await readFile(path, "utf8");
  const matches = edits.map((edit, index) => {
    const first = content.indexOf(edit.oldText);
    if (first < 0) throw new Error(`edits[${index}].oldText was not found.`);
    if (content.indexOf(edit.oldText, first + edit.oldText.length) >= 0) {
      throw new Error(
        `edits[${index}].oldText matched more than once; provide a unique region.`,
      );
    }
    return { ...edit, index, start: first, end: first + edit.oldText.length };
  });

  const ordered = [...matches].sort((a, b) => a.start - b.start);
  for (let i = 1; i < ordered.length; i++) {
    const previous = ordered[i - 1];
    const current = ordered[i];
    if (!previous || !current) continue;
    if (current.start < previous.end) {
      throw new Error(
        `edits[${current.index}] overlaps edits[${previous.index}]; merge overlapping changes.`,
      );
    }
  }

  let updated = content;
  for (const edit of [...ordered].reverse()) {
    updated = `${updated.slice(0, edit.start)}${edit.newText}${updated.slice(edit.end)}`;
  }
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, updated, "utf8");
  await rename(tempPath, path);
  return { path, content: `Edited file with ${edits.length} replacement(s).` };
}

type NormalizedEdit = { oldText: string; newText: string };

function normalizeEditOperations(
  args: Record<string, unknown>,
): NormalizedEdit[] {
  if (Array.isArray(args.edits)) {
    if (args.edits.length === 0) {
      throw new Error("Tool argument 'edits' must contain at least one edit.");
    }
    return args.edits.map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(`edits[${index}] must be an object.`);
      }
      const edit = entry as Record<string, unknown>;
      if (typeof edit.oldText !== "string" || edit.oldText.length === 0) {
        throw new Error(`edits[${index}].oldText must be a non-empty string.`);
      }
      if (typeof edit.newText !== "string") {
        throw new Error(`edits[${index}].newText must be a string.`);
      }
      return { oldText: edit.oldText, newText: edit.newText };
    });
  }

  if (typeof args.oldText !== "string" || args.oldText.length === 0) {
    throw new Error("Tool argument 'oldText' must be a non-empty string.");
  }
  if (typeof args.newText !== "string") {
    throw new Error("Tool argument 'newText' must be a string.");
  }
  return [{ oldText: args.oldText, newText: args.newText }];
}

async function executeBash(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  if (typeof args.command !== "string" || args.command.trim().length === 0) {
    throw new Error("Tool argument 'command' must be a non-empty string.");
  }
  const timeoutSeconds = Math.min(numberArg(args.timeout, 30), 120);
  try {
    const { stdout, stderr } = await execAsync(args.command, {
      cwd: context.cwd,
      timeout: timeoutSeconds * 1000,
      maxBuffer: 1024 * 1024 * 4,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as Error & {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message,
      exitCode: typeof failure.code === "number" ? failure.code : 1,
    };
  }
}

async function executeLs(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const root = resolveToolPath(context.cwd, args.path ?? ".");
  const limit = Math.min(numberArg(args.limit, 500), 5000);
  const dirEntries = await readdir(root, { withFileTypes: true });
  dirEntries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const entries: NonNullable<ToolExecutionResult["entries"]> = [];
  for (const entry of dirEntries.slice(0, limit)) {
    entries.push({
      path: `${entry.name}${entry.isDirectory() ? "/" : ""}`,
      kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
    });
  }
  return { path: root, entries };
}

async function executeFind(
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
    ["--hidden", "--glob", "--max-results", String(limit), "--", pattern, root],
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
  await walkFiles(root, root, limit, async (absolutePath, relativePath) => {
    if (regex.test(relativePath)) results.push(relativePath);
  });
  return results;
}

async function executeGrep(
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
  const glob = typeof args.glob === "string" ? globToRegExp(args.glob) : undefined;
  await walkFiles(root, root, limit, async (absolutePath, relativePath) => {
    if (glob && !glob.test(relativePath)) return;
    const info = await stat(absolutePath);
    if (info.size > 1024 * 1024) return;
    const content = await readFile(absolutePath, "utf8").catch(() => undefined);
    if (content === undefined) return;
    const lines = content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const haystack = ignoreCase ? line.toLowerCase() : line;
      if (regex ? regex.test(line) : haystack.includes(needle)) {
        matches.push({ path: relativePath, line: index + 1, text: line });
        if (matches.length >= limit) return;
      }
    }
  });
  return matches;
}

async function walkFiles(
  root: string,
  path: string,
  limit: number,
  onFile: (absolutePath: string, relativePath: string) => Promise<void>,
): Promise<void> {
  const info = await stat(path);
  if (info.isDirectory()) {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      await walkFiles(root, join(path, entry.name), limit, onFile);
    }
    return;
  }
  if (!info.isFile()) return;
  await access(path, constants.R_OK);
  await onFile(path, relative(root, path));
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

function numberArg(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}
