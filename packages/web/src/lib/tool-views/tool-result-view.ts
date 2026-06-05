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
      title?: string;
      path?: string;
      relPath?: string;
      lineLabel?: string;
      image?: { dataUrl: string; mimeType: string };
      content?: string;
      truncated: boolean;
    }
  | {
      kind: "bash";
      title?: string;
      command?: string;
      exitCode?: number;
      signal?: string | null;
      tailLines: string[];
      stdout?: string;
      stderr?: string;
      savedTo?: string;
      truncated: boolean;
      live?: boolean;
    }
  | {
      kind: "edit";
      title?: string;
      path?: string;
      relPath?: string;
      replacements: number;
      diff?: string;
    }
  | {
      kind: "write";
      title?: string;
      path?: string;
      relPath?: string;
      bytes?: number;
      content?: string;
    }
  | {
      kind: "grep";
      title?: string;
      pattern?: string;
      matchCount: number;
      fileCount: number;
      previewMatches: GroupedMatches[];
      allMatches: GroupedMatches[];
    }
  | {
      kind: "find";
      title?: string;
      pattern?: string;
      paths: string[];
      openPaths: string[];
      count: number;
    }
  | {
      kind: "ls";
      title?: string;
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
      title?: string;
      items: TodoItem[];
      completed: number;
      total: number;
    }
  | {
      kind: "process_action";
      title?: string;
      action: "start" | "stop" | "restart";
      process?: ProcessRecord;
    }
  | { kind: "process_list"; title?: string; processes: ProcessRecord[] }
  | {
      kind: "process_logs";
      title?: string;
      process?: ProcessRecord;
      events: ProcessLogEvent[];
      tailEvents: ProcessLogEvent[];
      mode?: string;
    }
  | {
      kind: "subagent_run";
      title?: string;
      task?: string;
      childAgentId?: string;
      summary?: string;
    }
  | {
      kind: "plan_mode";
      title?: string;
      summary?: string;
      planPath?: string;
    }
  | {
      kind: "web_search";
      title?: string;
      query?: string;
      answer?: string;
      results: Array<{ title: string; url: string }>;
      preview?: string;
    }
  | {
      kind: "web_fetch";
      title?: string;
      url?: string;
      status?: number;
      contentType?: string;
      size?: number;
      savedTo?: string;
      converted: boolean;
      preview?: string;
    }
  | { kind: "generic" };

const READ_PREVIEW = 10;
const LIST_PREVIEW = 10;
const LS_PREVIEW = 20;
const LOG_TAIL = 15;
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

function previewGrepMatch(match: GrepMatchView): GrepMatchView {
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
          title: relPath ? `${relPath} · image` : "image",
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
        title: [relPath, lineLabel].filter(Boolean).join(" · ") || undefined,
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
      const combined = result?.content ?? liveOutput?.text ?? "";
      const tailLines =
        combined.length > 0 ? tail(combined.split("\n"), READ_PREVIEW) : [];
      return {
        kind: "bash",
        title: command ? truncateTitle(command) : undefined,
        command,
        exitCode: result?.exitCode,
        signal: details.success
          ? (details.data.signal ?? undefined)
          : undefined,
        tailLines,
        stdout: result?.stdout,
        stderr: result?.stderr,
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
      return {
        kind: "edit",
        title: relPath
          ? `${relPath} · ${edits} replacement${edits === 1 ? "" : "s"}`
          : undefined,
        path,
        relPath,
        replacements: edits,
        diff: details.success ? details.data.diff : undefined,
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
        title: relPath
          ? `${relPath}${bytes !== undefined ? ` · wrote ${bytes} bytes` : ""}`
          : undefined,
        path,
        relPath,
        bytes,
        content,
      };
    }

    case "grep": {
      const pattern = stringField(args.pattern);
      const matches = (result?.matches ?? []).map((match) => ({
        ...match,
        openPath: resolveToolPath(match.path, cwd) ?? match.path,
      }));
      const all = groupMatchesByFile(matches);
      const fileCount = all.length;
      const preview: GroupedMatches[] = [];
      let shown = 0;
      for (const group of all) {
        if (shown >= LIST_PREVIEW) break;
        const slice = group.matches
          .slice(0, LIST_PREVIEW - shown)
          .map(previewGrepMatch);
        preview.push({ path: group.path, matches: slice });
        shown += slice.length;
      }
      return {
        kind: "grep",
        title: pattern
          ? `${truncateTitle(pattern)} · ${matches.length} match${matches.length === 1 ? "" : "es"} / ${fileCount} file${fileCount === 1 ? "" : "s"}`
          : undefined,
        pattern,
        matchCount: matches.length,
        fileCount,
        previewMatches: preview,
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
        title: pattern
          ? `${truncateTitle(pattern)} · ${paths.length} file${paths.length === 1 ? "" : "s"}`
          : undefined,
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
        title: `${relPath} · ${entries.length} entr${entries.length === 1 ? "y" : "ies"}`,
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
      const action = toolCall.toolName === "todos_set" ? "set" : "get";
      return {
        kind: "todos",
        title: `${action} todos · ${completed}/${items.length} done`,
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
      const label =
        process?.name ??
        process?.command ??
        stringField(args.name) ??
        stringField(args.command);
      return {
        kind: "process_action",
        title: label ? truncateTitle(label) : undefined,
        action,
        process,
      };
    }

    case "process_list": {
      const parsed = processListResultSchema.safeParse(toolCall.result);
      const processes = parsed.success ? parsed.data.processes : [];
      return {
        kind: "process_list",
        title: `${processes.length} process${processes.length === 1 ? "" : "es"}`,
        processes,
      };
    }

    case "process_logs": {
      const parsed = processLogsResultSchema.safeParse(toolCall.result);
      const data = parsed.success ? parsed.data : undefined;
      const events = data?.events ?? [];
      const label =
        data?.process.name ?? data?.process.id ?? stringField(args.name);
      return {
        kind: "process_logs",
        title:
          [
            label,
            data?.mode,
            `${events.length} event${events.length === 1 ? "" : "s"}`,
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
        process: data?.process,
        events,
        tailEvents: tail(events, LOG_TAIL),
        mode: data?.mode,
      };
    }

    case "subagent_run": {
      const parsed = subagentRunResultSchema.safeParse(toolCall.result);
      const data = parsed.success ? parsed.data : undefined;
      const task = stringField(args.task);
      return {
        kind: "subagent_run",
        title: task ? truncateTitle(task) : undefined,
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
        title: planDir ? `plan mode entered · ${planDir}` : "plan mode entered",
        summary: firstTextBlock(toolCall.result),
      };
    }

    case "plan_mode_present": {
      const resultRecord = asRecord(toolCall.result);
      const review = asRecord(resultRecord.review);
      const planPath =
        stringField(review.planPath) ?? stringField(args.file_path);
      const outcome = stringField(resultRecord.outcome);
      return {
        kind: "plan_mode",
        title: planPath
          ? `presented ${planPath}${outcome ? ` · ${outcome}` : ""}`
          : "presented plan",
        summary:
          stringField(resultRecord.feedback) ?? firstTextBlock(toolCall.result),
        planPath,
      };
    }

    case "plan_mode_force_exit": {
      const resultRecord = asRecord(toolCall.result);
      const reason = stringField(resultRecord.reason);
      return {
        kind: "plan_mode",
        title: "exited plan mode",
        summary: reason,
      };
    }

    case "web_search": {
      const details = webSearchResultDetailsSchema.safeParse(result?.details);
      const query = details.success
        ? details.data.query
        : stringField(args.query);
      const results = details.success ? details.data.results : [];
      const preview = result?.content
        ? trimTextPreview(result.content, {
            headLines: 8,
            tailLines: 2,
            maxChars: 2_000,
          }).text
        : undefined;
      return {
        kind: "web_search",
        title: query
          ? `${truncateTitle(query)} · ${results.length} result${results.length === 1 ? "" : "s"}`
          : undefined,
        query,
        answer: details.success ? details.data.answer : undefined,
        results,
        preview,
      };
    }

    case "web_fetch": {
      const details = webFetchResultDetailsSchema.safeParse(result?.details);
      const data = details.success ? details.data : undefined;
      const url = data?.url ?? stringField(args.url);
      const preview = result?.content
        ? trimTextPreview(result.content, {
            headLines: 10,
            tailLines: 4,
            maxChars: 4_000,
          }).text
        : undefined;
      return {
        kind: "web_fetch",
        title: url
          ? `${truncateTitle(url)}${data?.status ? ` · ${data.status}` : ""}`
          : undefined,
        url,
        status: data?.status,
        contentType: data?.contentType,
        size: data?.size,
        savedTo: data?.savedTo,
        converted: data?.converted ?? false,
        preview,
      };
    }

    default:
      return { kind: "generic" };
  }
}

export const PREVIEW_LIMITS = {
  READ_PREVIEW,
  LIST_PREVIEW,
  LS_PREVIEW,
  LOG_TAIL,
} as const;
