import {
  askUserResultSchema,
  bashResultDetailsSchema,
  editResultDetailsSchema,
  type FileEntry,
  type GrepMatch,
  type ProcessLogEvent,
  type ProcessRecord,
  processActionResultSchema,
  processListResultSchema,
  processLogsResultSchema,
  subagentRunResultSchema,
  type TodoItem,
  todosResultSchema,
  toolExecutionResultSchema,
  truncationDetailsSchema,
  webFetchResultDetailsSchema,
  webSearchResultDetailsSchema,
} from "@nerve/shared";
import type { ToolCallRecord } from "../api";
import type { LiveToolOutput } from "../stores/workbench/state.svelte";
import { trimTextPreview } from "../utils/text-preview";

export type GrepMatchView = GrepMatch & { openPath?: string };
export type GroupedMatches = {
  path: string;
  openPath?: string;
  matches: GrepMatchView[];
};

export type ToolView =
  | {
      kind: "read";
      path?: string;
      relPath?: string;
      lineLabel?: string;
      image?: { dataUrl: string; mimeType: string };
      content?: string;
      truncated: boolean;
    }
  | {
      kind: "bash";
      command?: string;
      exitCode?: number;
      signal?: string | null;
      output: string;
      savedTo?: string;
      truncated: boolean;
      live?: boolean;
    }
  | {
      kind: "edit";
      path?: string;
      relPath?: string;
      replacements: number;
      additions: number;
      deletions: number;
      diff?: string;
    }
  | {
      kind: "write";
      path?: string;
      relPath?: string;
      bytes?: number;
      content?: string;
    }
  | {
      kind: "grep";
      pattern?: string;
      matchCount: number;
      fileCount: number;
      allMatches: GroupedMatches[];
    }
  | {
      kind: "find";
      pattern?: string;
      paths: string[];
      openPaths: string[];
      count: number;
    }
  | {
      kind: "ls";
      path?: string;
      relPath?: string;
      entries: Array<FileEntry & { openPath?: string }>;
      total: number;
    }
  | {
      kind: "ask_user";
      question?: string;
      context?: string;
      recommendation?: string;
      answer?: string;
      dismissed: boolean;
      dismissedReason?: string;
    }
  | {
      kind: "todos";
      items: TodoItem[];
      completed: number;
      total: number;
    }
  | {
      kind: "process_action";
      action: "start" | "stop" | "restart";
      process?: ProcessRecord;
    }
  | { kind: "process_list"; processes: ProcessRecord[] }
  | {
      kind: "process_logs";
      process?: ProcessRecord;
      events: ProcessLogEvent[];
      mode?: string;
    }
  | {
      kind: "subagent_run";
      task?: string;
      childAgentId?: string;
      summary?: string;
    }
  | {
      kind: "plan_mode";
      action: "enter" | "present" | "force_exit";
      summary?: string;
      planPath?: string;
      outcome?: string;
    }
  | {
      kind: "web_search";
      query?: string;
      answer?: string;
      results: Array<{ title: string; url: string }>;
    }
  | {
      kind: "web_fetch";
      url?: string;
      status?: number;
      contentType?: string;
      size?: number;
      savedTo?: string;
      converted: boolean;
      content?: string;
    }
  | { kind: "generic" };

/** Lines/items shown before the footer "Show more" toggle expands a body. */
export const COLLAPSED_LINES = 10;
const TITLE_MAX = 120;
const GREP_MATCH_TEXT_MAX = 260;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function todoItemsField(value: unknown): TodoItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: TodoItem[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (typeof record.todo !== "string" || typeof record.done !== "boolean") {
      return undefined;
    }
    items.push({ todo: record.todo, done: record.done });
  }
  return items;
}

function firstTextBlock(value: unknown): string | undefined {
  const blocks = asRecord(value).contentBlocks;
  if (!Array.isArray(blocks)) return undefined;
  const textBlock = blocks.find(
    (block) =>
      block &&
      typeof block === "object" &&
      (block as Record<string, unknown>).type === "text" &&
      typeof (block as Record<string, unknown>).text === "string",
  ) as { text?: string } | undefined;
  return textBlock?.text;
}

export function relativePath(
  path: string | undefined,
  cwd: string,
): string | undefined {
  if (!path) return undefined;
  if (path === cwd) return ".";
  const prefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

export function tail<T>(items: T[], count: number): T[] {
  return items.length > count ? items.slice(items.length - count) : items;
}

export function truncateTitle(text: string): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > TITLE_MAX
    ? `${single.slice(0, TITLE_MAX - 1)}…`
    : single;
}

export function imageDataUrl(mimeType: string, data: string): string {
  return `data:${mimeType};base64,${data}`;
}

function trimMatchText(match: GrepMatchView): GrepMatchView {
  return {
    ...match,
    text: trimTextPreview(match.text, {
      headLines: 2,
      tailLines: 1,
      maxChars: GREP_MATCH_TEXT_MAX,
    }).text,
  };
}

export function groupMatchesByFile(matches: GrepMatchView[]): GroupedMatches[] {
  const groups: GroupedMatches[] = [];
  const byPath = new Map<string, GrepMatchView[]>();
  for (const match of matches) {
    let bucket = byPath.get(match.path);
    if (!bucket) {
      bucket = [];
      byPath.set(match.path, bucket);
      groups.push({
        path: match.path,
        openPath: match.openPath,
        matches: bucket,
      });
    }
    bucket.push(match);
  }
  return groups;
}

function resolveToolPath(
  path: string | undefined,
  cwd: string,
): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("/")) return path;
  return `${cwd.replace(/\/$/, "")}/${path}`;
}

function detailsTruncated(details: unknown): boolean {
  const record = asRecord(details);
  const direct = truncationDetailsSchema.safeParse(details);
  if (direct.success && direct.data.truncated) return true;
  const nested = truncationDetailsSchema.safeParse(record.truncation);
  return Boolean(nested.success && nested.data.truncated);
}

function diffStats(diff: string | undefined): {
  additions: number;
  deletions: number;
} {
  if (!diff) return { additions: 0, deletions: 0 };
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

export function parseToolView(
  toolCall: ToolCallRecord,
  liveOutput?: LiveToolOutput,
): ToolView {
  const args = asRecord(toolCall.args);
  const cwd = toolCall.cwd;
  const fileResult = toolExecutionResultSchema.safeParse(toolCall.result);
  const result = fileResult.success ? fileResult.data : undefined;

  switch (toolCall.toolName) {
    case "read": {
      const path = resolveToolPath(result?.path ?? stringField(args.path), cwd);
      const relPath = relativePath(path, cwd);
      const imageBlock = result?.contentBlocks?.find(
        (block) => block.type === "image",
      );
      if (imageBlock && imageBlock.type === "image") {
        return {
          kind: "read",
          path,
          relPath,
          image: {
            dataUrl: imageDataUrl(imageBlock.mimeType, imageBlock.data),
            mimeType: imageBlock.mimeType,
          },
          truncated: false,
        };
      }
      const content = result?.content;
      const hasRange =
        typeof args.offset === "number" || typeof args.limit === "number";
      let lineLabel: string | undefined;
      if (content !== undefined) {
        const count = content.length === 0 ? 0 : content.split("\n").length;
        if (hasRange && typeof args.offset === "number") {
          const start = args.offset as number;
          lineLabel = `lines ${start}–${start + count - 1}`;
        } else {
          lineLabel = `${count} line${count === 1 ? "" : "s"}`;
        }
      }
      return {
        kind: "read",
        path,
        relPath,
        lineLabel,
        content,
        truncated: detailsTruncated(result?.details),
      };
    }

    case "bash": {
      const command = stringField(args.command);
      const details = bashResultDetailsSchema.safeParse(result?.details);
      const output = result?.content ?? liveOutput?.text ?? "";
      return {
        kind: "bash",
        command,
        exitCode: result?.exitCode,
        signal: details.success
          ? (details.data.signal ?? undefined)
          : undefined,
        output,
        savedTo: details.success ? details.data.fullOutputPath : undefined,
        truncated: detailsTruncated(result?.details),
        live: !result && Boolean(liveOutput?.text),
      };
    }

    case "edit": {
      const path = resolveToolPath(result?.path ?? stringField(args.path), cwd);
      const relPath = relativePath(path, cwd);
      const edits = Array.isArray(args.edits) ? args.edits.length : 0;
      const details = editResultDetailsSchema.safeParse(result?.details);
      const diff = details.success ? details.data.diff : undefined;
      const { additions, deletions } = diffStats(diff);
      return {
        kind: "edit",
        path,
        relPath,
        replacements: edits,
        additions,
        deletions,
        diff,
      };
    }

    case "write": {
      const path = resolveToolPath(result?.path ?? stringField(args.path), cwd);
      const relPath = relativePath(path, cwd);
      const content = stringField(args.content);
      const byteMatch = result?.content?.match(/Wrote (\d+) bytes/);
      const bytes = byteMatch ? Number(byteMatch[1]) : undefined;
      return {
        kind: "write",
        path,
        relPath,
        bytes,
        content,
      };
    }

    case "grep": {
      const pattern = stringField(args.pattern);
      const matches = (result?.matches ?? []).map((match) =>
        trimMatchText({
          ...match,
          openPath: resolveToolPath(match.path, cwd) ?? match.path,
        }),
      );
      const all = groupMatchesByFile(matches);
      return {
        kind: "grep",
        pattern,
        matchCount: matches.length,
        fileCount: all.length,
        allMatches: all,
      };
    }

    case "find": {
      const pattern = stringField(args.pattern);
      const entries = result?.entries ?? [];
      const paths = entries.map((entry) => entry.path);
      const openPaths = entries.map(
        (entry) => resolveToolPath(entry.path, cwd) ?? entry.path,
      );
      return {
        kind: "find",
        pattern,
        paths,
        openPaths,
        count: paths.length,
      };
    }

    case "ls": {
      const path = resolveToolPath(result?.path ?? stringField(args.path), cwd);
      const relPath = relativePath(path, cwd) ?? ".";
      const entries = (result?.entries ?? []).map((entry) => ({
        ...entry,
        openPath: resolveToolPath(entry.path, path ?? cwd) ?? entry.path,
      }));
      return {
        kind: "ls",
        path,
        relPath,
        entries,
        total: entries.length,
      };
    }

    case "ask_user": {
      const parsed = askUserResultSchema.safeParse(toolCall.result);
      const data = parsed.success ? parsed.data : undefined;
      return {
        kind: "ask_user",
        question: data?.question ?? stringField(args.question),
        context: data?.context ?? stringField(args.context),
        recommendation:
          data?.recommendation ?? stringField(args.recommendation),
        answer: data?.response,
        dismissed: Boolean(data?.dismissed),
        dismissedReason: data?.dismissedReason,
      };
    }

    case "todos_set":
    case "todos_get": {
      const parsed = todosResultSchema.safeParse(toolCall.result);
      const fromResult = parsed.success
        ? parsed.data.details?.todos
        : undefined;
      const items = fromResult ?? todoItemsField(args.todos) ?? [];
      const completed = items.filter((item) => item.done).length;
      return {
        kind: "todos",
        items,
        completed,
        total: items.length,
      };
    }

    case "process_start":
    case "process_stop":
    case "process_restart": {
      const action = toolCall.toolName.replace("process_", "") as
        | "start"
        | "stop"
        | "restart";
      const parsed = processActionResultSchema.safeParse(toolCall.result);
      const process = parsed.success ? parsed.data.process : undefined;
      return {
        kind: "process_action",
        action,
        process,
      };
    }

    case "process_list": {
      const parsed = processListResultSchema.safeParse(toolCall.result);
      const processes = parsed.success ? parsed.data.processes : [];
      return {
        kind: "process_list",
        processes,
      };
    }

    case "process_logs": {
      const parsed = processLogsResultSchema.safeParse(toolCall.result);
      const data = parsed.success ? parsed.data : undefined;
      const events = data?.events ?? [];
      return {
        kind: "process_logs",
        process: data?.process,
        events,
        mode: data?.mode,
      };
    }

    case "subagent_run": {
      const parsed = subagentRunResultSchema.safeParse(toolCall.result);
      const data = parsed.success ? parsed.data : undefined;
      const task = stringField(args.task);
      return {
        kind: "subagent_run",
        task,
        childAgentId: data?.agent.id,
        summary: data?.summary,
      };
    }

    case "plan_mode_enter": {
      const resultRecord = asRecord(toolCall.result);
      const planDir = stringField(resultRecord.planDir);
      return {
        kind: "plan_mode",
        action: "enter",
        summary: firstTextBlock(toolCall.result),
        planPath: planDir,
      };
    }

    case "plan_mode_present": {
      const resultRecord = asRecord(toolCall.result);
      const review = asRecord(resultRecord.review);
      const planPath =
        stringField(review.planPath) ?? stringField(args.file_path);
      const outcome =
        stringField(resultRecord.outcome) ?? stringField(review.status);
      return {
        kind: "plan_mode",
        action: "present",
        summary:
          stringField(resultRecord.feedback) ?? firstTextBlock(toolCall.result),
        planPath,
        outcome,
      };
    }

    case "plan_mode_force_exit": {
      const resultRecord = asRecord(toolCall.result);
      const reason = stringField(resultRecord.reason);
      return {
        kind: "plan_mode",
        action: "force_exit",
        summary: reason,
      };
    }

    case "web_search": {
      const details = webSearchResultDetailsSchema.safeParse(result?.details);
      const query = details.success
        ? details.data.query
        : stringField(args.query);
      const results = details.success ? details.data.results : [];
      return {
        kind: "web_search",
        query,
        answer: details.success ? details.data.answer : undefined,
        results,
      };
    }

    case "web_fetch": {
      const details = webFetchResultDetailsSchema.safeParse(result?.details);
      const data = details.success ? details.data : undefined;
      const url = data?.url ?? stringField(args.url);
      return {
        kind: "web_fetch",
        url,
        status: data?.status,
        contentType: data?.contentType,
        size: data?.size,
        savedTo: data?.savedTo,
        converted: data?.converted ?? false,
        content: result?.content,
      };
    }

    default:
      return { kind: "generic" };
  }
}
