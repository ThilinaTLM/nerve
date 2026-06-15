import {
  askUserResultSchema,
  bashResultDetailsSchema,
  type ExploreReportPayload,
  editResultDetailsSchema,
  exploreResultSchema,
  type FileEntry,
  type GrepMatch,
  type ProcessLogEvent,
  type ProcessRecord,
  type ProcessStreamResultDetails,
  type PythonArtifactResultDetails,
  processActionResultSchema,
  processListResultSchema,
  processLogsResultSchema,
  pythonResultDetailsSchema,
  type TodoItem,
  todosResultSchema,
  toolExecutionResultSchema,
  truncationDetailsSchema,
  webFetchResultDetailsSchema,
  webSearchResultDetailsSchema,
} from "@nerve/shared";
import type { ToolCallRecord } from "$lib/api";
import type { LiveToolOutput } from "$lib/stores/workbench/state.svelte";
import {
  relativePathForDisplay,
  resolveDisplayPath,
} from "$lib/utils/path-links";
import { trimTextPreview } from "$lib/utils/text-preview";

export type GrepMatchView = GrepMatch & { openPath?: string };
export type GroupedMatches = {
  path: string;
  openPath?: string;
  matches: GrepMatchView[];
};

export type ExploreProgressView = {
  type: "explore_progress";
  timestamp: string;
  agentId?: string;
  taskIndex?: number;
  taskCount?: number;
  label?: string;
  phase:
    | "queued"
    | "started"
    | "tool_call"
    | "tool_result"
    | "assistant"
    | "completed"
    | "failed";
  message: string;
};

export type ExploreTaskStatus = "queued" | "running" | "completed" | "failed";

export type ExploreTaskState = {
  /** Stable key so rows never reshuffle. */
  key: string;
  index?: number;
  count?: number;
  label?: string;
  task?: string;
  agentId?: string;
  status: ExploreTaskStatus;
  /** De-noised latest activity while running. */
  currentAction?: string;
  /** Whether currentAction is a concrete tool action (render as mono). */
  currentActionMono: boolean;
  /** Count of tool_call updates seen (activity meter). */
  actionCount: number;
  report?: ExploreReportPayload;
  error?: string;
};

export type ExploreSummary = {
  total: number;
  completed: number;
  failed: number;
  running: number;
  done: boolean;
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
      kind: "python";
      code?: string;
      codeLineCount: number;
      exitCode?: number;
      signal?: string | null;
      output: string;
      savedTo?: string;
      truncated: boolean;
      live?: boolean;
      allowNetwork?: boolean;
      allowFileWrite?: boolean;
      durationMs?: number;
      timedOut?: boolean;
      timeoutKilled?: boolean;
      envKeys?: string[];
      artifactDir?: string;
      artifacts?: PythonArtifactResultDetails[];
      streams?: {
        stdout?: ProcessStreamResultDetails;
        stderr?: ProcessStreamResultDetails;
        combined?: ProcessStreamResultDetails;
      };
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
      kind: "explore";
      task?: string;
      reports: ExploreReportPayload[];
      liveUpdates: ExploreProgressView[];
      liveLog?: string;
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
const GREP_MATCH_TEXT_MAX = 260;

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string" && value.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Fall through to the empty record for non-JSON strings.
    }
  }
  return {};
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseToolExecutionResult(value: unknown) {
  const direct = toolExecutionResultSchema.safeParse(value);
  if (direct.success) return direct.data;
  const parsedRecord = asRecord(value);
  if (Object.keys(parsedRecord).length === 0) return undefined;
  const parsed = toolExecutionResultSchema.safeParse(parsedRecord);
  return parsed.success ? parsed.data : undefined;
}

function textContentBlocks(value: unknown): string | undefined {
  const blocks = asRecord(value).contentBlocks;
  if (!Array.isArray(blocks)) return undefined;
  const texts = blocks.flatMap((block) => {
    const record = asRecord(block);
    return record.type === "text" && typeof record.text === "string"
      ? [record.text]
      : [];
  });
  return texts.length > 0 ? texts.join("\n") : undefined;
}

function combinedStreamOutput(value: unknown): string | undefined {
  const record = asRecord(value);
  const stdout = stringField(record.stdout);
  const stderr = stringField(record.stderr);
  if (stdout === undefined && stderr === undefined) return undefined;
  if (!stdout) return stderr && stderr.length > 0 ? stderr : undefined;
  if (!stderr) return stdout.length > 0 ? stdout : undefined;
  return stdout.endsWith("\n") ? `${stdout}${stderr}` : `${stdout}\n${stderr}`;
}

function resultOutputText(
  result: ReturnType<typeof parseToolExecutionResult>,
  rawResult: unknown,
  liveOutput?: LiveToolOutput,
): string {
  return (
    result?.content ??
    textContentBlocks(result) ??
    textContentBlocks(rawResult) ??
    combinedStreamOutput(result) ??
    combinedStreamOutput(rawResult) ??
    liveOutput?.text ??
    ""
  );
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
  return relativePathForDisplay(path, cwd);
}

export function tail<T>(items: T[], count: number): T[] {
  return items.length > count ? items.slice(items.length - count) : items;
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
  return resolveDisplayPath(path, cwd);
}

function detailsTruncated(details: unknown): boolean {
  const record = asRecord(details);
  const direct = truncationDetailsSchema.safeParse(details);
  if (direct.success && direct.data.truncated) return true;
  const nested = truncationDetailsSchema.safeParse(record.truncation);
  return Boolean(nested.success && nested.data.truncated);
}

function parseExploreProgressLog(text: string | undefined): {
  updates: ExploreProgressView[];
  fallback?: string;
} {
  if (!text) return { updates: [] };
  const updates: ExploreProgressView[] = [];
  const fallbackLines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const record = asRecord(parsed);
      if (
        record.type === "explore_progress" &&
        typeof record.timestamp === "string" &&
        typeof record.phase === "string" &&
        typeof record.message === "string"
      ) {
        updates.push({
          type: "explore_progress",
          timestamp: record.timestamp,
          agentId: stringField(record.agentId),
          taskIndex:
            typeof record.taskIndex === "number" ? record.taskIndex : undefined,
          taskCount:
            typeof record.taskCount === "number" ? record.taskCount : undefined,
          label: stringField(record.label),
          phase: record.phase as ExploreProgressView["phase"],
          message: record.message,
        });
        continue;
      }
    } catch {
      // Fall back to plain log rendering for older in-flight output.
    }
    fallbackLines.push(line);
  }
  return {
    updates,
    fallback: fallbackLines.length > 0 ? fallbackLines.join("\n") : undefined,
  };
}

const EXPLORE_NOISE_MESSAGES = new Set([
  "Assistant response started.",
  "Final report received.",
]);

function friendlyExploreAction(
  update: ExploreProgressView,
): { text: string; mono: boolean } | undefined {
  switch (update.phase) {
    case "queued":
      return undefined;
    case "started":
      return { text: "Starting\u2026", mono: false };
    case "assistant":
      return { text: "Thinking\u2026", mono: false };
    case "tool_call":
    case "tool_result":
      return { text: update.message, mono: true };
    default:
      return { text: update.message, mono: false };
  }
}

/**
 * Fold explore reports + streamed progress into a stable, per-agent model so the
 * transcript view stays purely presentational. Rows are index-ordered and keyed,
 * so they never reshuffle as live updates arrive.
 */
export function aggregateExploreTasks(
  view: Extract<ToolView, { kind: "explore" }>,
): { tasks: ExploreTaskState[]; summary: ExploreSummary } {
  const reports = view.reports;
  const byIndex = new Map<number, ExploreProgressView[]>();
  let maxSeenIndex = -1;
  let declaredCount = 0;

  for (const update of view.liveUpdates) {
    if (typeof update.taskCount === "number") {
      declaredCount = Math.max(declaredCount, update.taskCount);
    }
    if (typeof update.taskIndex !== "number") continue;
    maxSeenIndex = Math.max(maxSeenIndex, update.taskIndex);
    const bucket = byIndex.get(update.taskIndex) ?? [];
    bucket.push(update);
    byIndex.set(update.taskIndex, bucket);
  }

  const total = Math.max(
    declaredCount,
    reports.length,
    maxSeenIndex + 1,
    view.liveUpdates.length > 0 || reports.length > 0 ? 1 : 0,
  );

  const tasks: ExploreTaskState[] = [];
  for (let index = 0; index < total; index += 1) {
    const report = reports[index];
    const updates = byIndex.get(index) ?? [];
    const latest = updates[updates.length - 1];
    const lastTool = [...updates]
      .reverse()
      .find(
        (u) =>
          (u.phase === "tool_call" || u.phase === "tool_result") &&
          !EXPLORE_NOISE_MESSAGES.has(u.message),
      );
    const failed = updates.find((u) => u.phase === "failed");

    let status: ExploreTaskStatus;
    if (report?.status === "failed" || report?.status === "aborted") {
      status = "failed";
    } else if (
      report?.status === "completed" ||
      report ||
      updates.some((u) => u.phase === "completed")
    ) {
      status = "completed";
    } else if (failed) {
      status = "failed";
    } else if (
      updates.some((u) =>
        ["started", "tool_call", "tool_result", "assistant"].includes(u.phase),
      )
    ) {
      status = "running";
    } else {
      status = "queued";
    }

    const action =
      status === "running"
        ? friendlyExploreAction(lastTool ?? latest ?? updates[0])
        : undefined;

    tasks.push({
      key: `task-${index}`,
      index,
      count: total || undefined,
      label: report?.label ?? latest?.label,
      task: report?.task ?? view.task,
      agentId: report?.agentId ?? latest?.agentId,
      status,
      currentAction: action?.text,
      currentActionMono: action?.mono ?? false,
      actionCount: updates.filter((u) => u.phase === "tool_call").length,
      report,
      error: report?.errorMessage ?? report?.summaryPreview ?? failed?.message,
    });
  }

  const completed = tasks.filter((t) => t.status === "completed").length;
  const failedCount = tasks.filter((t) => t.status === "failed").length;
  const running = tasks.filter(
    (t) => t.status === "running" || t.status === "queued",
  ).length;

  return {
    tasks,
    summary: {
      total,
      completed,
      failed: failedCount,
      running,
      done: total > 0 && completed + failedCount === total,
    },
  };
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
  const result = parseToolExecutionResult(toolCall.result);

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
      const output = resultOutputText(result, toolCall.result, liveOutput);
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

    case "python": {
      const code = stringField(args.code);
      const details = pythonResultDetailsSchema.safeParse(result?.details);
      const output = resultOutputText(result, toolCall.result, liveOutput);
      const codeLineCount = code ? code.split(/\r?\n/).length : 0;
      return {
        kind: "python",
        code,
        codeLineCount,
        exitCode: result?.exitCode,
        signal: details.success
          ? (details.data.signal ?? undefined)
          : undefined,
        output,
        savedTo: details.success ? details.data.fullOutputPath : undefined,
        truncated: detailsTruncated(result?.details),
        live: !result && Boolean(liveOutput?.text),
        allowNetwork: details.success ? details.data.allowNetwork : undefined,
        allowFileWrite: details.success
          ? details.data.allowFileWrite
          : undefined,
        durationMs: details.success ? details.data.durationMs : undefined,
        timedOut: details.success ? details.data.timedOut : undefined,
        timeoutKilled: details.success ? details.data.timeoutKilled : undefined,
        envKeys: details.success ? details.data.envKeys : undefined,
        artifactDir: details.success ? details.data.artifactDir : undefined,
        artifacts: details.success ? details.data.artifacts : undefined,
        streams: details.success ? details.data.streams : undefined,
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
      const searchRoot =
        resolveToolPath(result?.path, cwd) ??
        resolveToolPath(stringField(args.path) ?? ".", cwd) ??
        cwd;
      const matches = (result?.matches ?? []).map((match) =>
        trimMatchText({
          ...match,
          openPath: resolveToolPath(match.path, searchRoot) ?? match.path,
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
      const searchRoot =
        resolveToolPath(result?.path, cwd) ??
        resolveToolPath(stringField(args.path) ?? ".", cwd) ??
        cwd;
      const paths = entries.map((entry) => entry.path);
      const openPaths = entries.map(
        (entry) => resolveToolPath(entry.path, searchRoot) ?? entry.path,
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

    case "explore": {
      const parsed = exploreResultSchema.safeParse(toolCall.result);
      const data = parsed.success ? parsed.data : undefined;
      const task = stringField(args.task);
      const liveProgress = parseExploreProgressLog(liveOutput?.text);
      return {
        kind: "explore",
        task,
        reports: data?.reports ?? [],
        liveUpdates: liveProgress.updates,
        liveLog: liveProgress.fallback,
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
