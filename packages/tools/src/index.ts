import { exec } from "node:child_process";
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
  cwd?: unknown;
  timeoutMs?: unknown;
};

export type ListToolArgs = ToolPathArgs & {
  recursive?: unknown;
  maxEntries?: unknown;
};

export type SearchToolArgs = ToolPathArgs & {
  pattern?: unknown;
  regex?: unknown;
  maxResults?: unknown;
};

export function toolRiskForName(name: ToolName): ToolRisk {
  return coreToolRiskForName(name);
}

export function isKnownReadOnlyCommand(command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (!normalized) return false;
  const first = normalized.split(" ")[0];
  if (["pwd", "ls", "find", "rg", "grep", "which"].includes(first)) return true;
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
    case "write":
      return executeWrite(args, context);
    case "edit":
      return executeEdit(args, context);
    case "bash":
      return executeBash(args, context);
    case "list":
      return executeList(args, context);
    case "search":
      return executeSearch(args, context);
    case "process_start":
    case "process_stop":
    case "process_restart":
    case "process_list":
    case "process_logs":
      throw new Error(
        `${name} is executed by the orchestrator process manager.`,
      );
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
  const limit = numberArg(args.limit, lines.length);
  return {
    path,
    content: lines
      .slice(Math.max(0, offset - 1), Math.max(0, offset - 1) + limit)
      .join("\n"),
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
    const previous = ordered[i - 1]!;
    const current = ordered[i]!;
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
  const cwd =
    typeof args.cwd === "string" && args.cwd.trim()
      ? resolve(context.cwd, args.cwd)
      : context.cwd;
  const timeout = Math.min(numberArg(args.timeoutMs, 30_000), 120_000);
  try {
    const { stdout, stderr } = await execAsync(args.command, {
      cwd,
      timeout,
      maxBuffer: 1024 * 1024 * 4,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as Error & {
      stdout?: string;
      stderr?: string;
      code?: number;
      signal?: string;
    };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message,
      exitCode: typeof failure.code === "number" ? failure.code : 1,
    };
  }
}

async function executeList(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const root = resolveToolPath(context.cwd, args.path ?? ".");
  const recursive = Boolean(args.recursive);
  const maxEntries = Math.min(numberArg(args.maxEntries, 200), 2000);
  const entries: ToolExecutionResult["entries"] = [];
  await collectEntries(root, root, recursive, maxEntries, entries);
  return { path: root, entries };
}

async function executeSearch(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const root = resolveToolPath(context.cwd, args.path ?? ".");
  if (typeof args.pattern !== "string" || args.pattern.length === 0) {
    throw new Error("Tool argument 'pattern' must be a non-empty string.");
  }
  const maxResults = Math.min(numberArg(args.maxResults, 200), 2000);
  const matcher = args.regex ? new RegExp(args.pattern) : undefined;
  const matches: NonNullable<ToolExecutionResult["matches"]> = [];
  await searchPath(root, root, args.pattern, matcher, maxResults, matches);
  return { path: root, matches };
}

async function collectEntries(
  root: string,
  path: string,
  recursive: boolean,
  maxEntries: number,
  output: NonNullable<ToolExecutionResult["entries"]>,
): Promise<void> {
  if (output.length >= maxEntries) return;
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const fullPath = join(path, entry.name);
    output.push({
      path: relative(root, fullPath) || entry.name,
      kind: entry.isDirectory()
        ? "directory"
        : entry.isFile()
          ? "file"
          : "other",
    });
    if (output.length >= maxEntries) return;
    if (recursive && entry.isDirectory())
      await collectEntries(root, fullPath, true, maxEntries, output);
  }
}

async function searchPath(
  root: string,
  path: string,
  pattern: string,
  matcher: RegExp | undefined,
  maxResults: number,
  output: NonNullable<ToolExecutionResult["matches"]>,
): Promise<void> {
  if (output.length >= maxResults) return;
  const info = await stat(path);
  if (info.isDirectory()) {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      await searchPath(
        root,
        join(path, entry.name),
        pattern,
        matcher,
        maxResults,
        output,
      );
      if (output.length >= maxResults) return;
    }
    return;
  }
  if (!info.isFile() || info.size > 1024 * 1024) return;
  await access(path, constants.R_OK);
  const content = await readFile(path, "utf8").catch(() => undefined);
  if (content === undefined) return;
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (matcher ? matcher.test(line) : line.includes(pattern)) {
      output.push({ path: relative(root, path), line: index + 1, text: line });
      if (output.length >= maxResults) return;
    }
  }
}

function numberArg(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}
