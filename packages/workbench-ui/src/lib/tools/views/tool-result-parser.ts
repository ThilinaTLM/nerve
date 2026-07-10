import {
  askUserResultSchema,
  bashResultDetailsSchema,
  editOperationResultDetailsSchema,
  exploreResultSchema,
  pythonResultDetailsSchema,
  taskActionResultSchema,
  taskListResultSchema,
  taskLogsResultSchema,
  taskRecordSchema,
  todosResultSchema,
  webFetchResultDetailsSchema,
  webSearchResultDetailsSchema,
} from "@nervekit/contracts";
import type {
  ToolCallRecord,
  ToolCallTranscriptRecord,
} from "../../state/tool-types";
export type ToolCallDisplayRecord = ToolCallRecord | ToolCallTranscriptRecord;

import { LruCache } from "@nervekit/ui-kit/core/utils/lru-cache";
import type { LiveToolOutput } from "../../state/transcript-types";
import { parseConfluenceView } from "./confluence-result-view";
import { parseExploreProgressLog } from "./explore-progress";
import { parseJiraView } from "./jira-result-view";
import {
  asRecord,
  detailsTruncated,
  diffStats,
  firstTextBlock,
  groupMatchesByFile,
  imageDataUrl,
  outputArtifactsFromDetails,
  outputLimitsFromDetails,
  parseToolExecutionResult,
  relativePath,
  resolveToolPath,
  resultOutputText,
  stringField,
  todoItemsField,
  trimMatchText,
} from "./tool-view-helpers";
import type { ToolView } from "./tool-view-types";

export { aggregateExploreTasks } from "./explore-progress";
// Re-export the supporting modules so existing consumers that import from this
// file (via tool-result-view) keep a single, stable surface.
export {
  COLLAPSED_LINES,
  groupMatchesByFile,
  imageDataUrl,
  relativePath,
  tail,
} from "./tool-view-helpers";
export type {
  ExploreProgressView,
  ExploreSummary,
  ExploreTaskState,
  ExploreTaskStatus,
  GrepMatchView,
  GroupedMatches,
  ToolView,
} from "./tool-view-types";

function arrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function editShorthandOperationCount(args: Record<string, unknown>): number {
  return (
    arrayField(args.replacements).length +
    arrayField(args.insertions).length +
    arrayField(args.lineReplacements).length +
    arrayField(args.lineInsertions).length +
    (typeof args.patch === "string" && args.patch.length > 0 ? 1 : 0)
  );
}

function countLines(text: string | undefined): number {
  if (!text) return 0;
  return text.length === 0 ? 0 : text.split("\n").length;
}

function previewOverflowHidden(
  toolCall: ToolCallDisplayRecord,
  noun: string,
  direction?: "head" | "tail" | "mixed",
): number {
  const overflow =
    "previewOverflow" in toolCall ? toolCall.previewOverflow : undefined;
  if (!overflow || overflow.noun !== noun) return 0;
  if (direction && overflow.direction !== direction) return 0;
  return overflow.hidden;
}

function actualPreviewCount(
  visible: number,
  toolCall: ToolCallDisplayRecord,
  noun: string,
  direction?: "head" | "tail" | "mixed",
): number {
  return visible + previewOverflowHidden(toolCall, noun, direction);
}

function modelDisplayedLines(
  outputLimits: ReturnType<typeof outputLimitsFromDetails>,
): number | undefined {
  return outputLimits?.model?.displayedLines;
}

function actualTextLineCount(
  text: string | undefined,
  toolCall: ToolCallDisplayRecord,
  noun: string,
  direction?: "head" | "tail" | "mixed",
  outputLimits?: ReturnType<typeof outputLimitsFromDetails>,
): number {
  return (
    modelDisplayedLines(outputLimits) ??
    actualPreviewCount(countLines(text), toolCall, noun, direction)
  );
}

// Memoize the (zod-heavy) tool-result projection. parseToolView re-runs on
// every card mount (tab switch / scroll into view) and on every live
// `tool_call.updated`; caching by tool-call identity + revision lets stable
// cards reuse the parsed view instead of re-running schema parsing.
const toolViewCache = new LruCache<string, ToolView>(300);

function payloadSignature(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return `s:${value.length}`;
  try {
    return `j:${JSON.stringify(value)?.length ?? 0}`;
  } catch {
    return "u";
  }
}

function toolViewSignature(
  toolCall: ToolCallDisplayRecord,
  liveOutput?: LiveToolOutput,
): string {
  const payloads = toolCall as ToolCallDisplayRecord & {
    args?: unknown;
    result?: unknown;
    argsPreview?: unknown;
    resultPreview?: unknown;
  };
  const mode = "result" in toolCall || "args" in toolCall ? "full" : "preview";
  const overflow =
    "previewOverflow" in toolCall ? toolCall.previewOverflow : undefined;
  return [
    toolCall.id,
    toolCall.status,
    toolCall.updatedAt,
    mode,
    payloadSignature(payloads.argsPreview ?? payloads.args),
    payloadSignature(payloads.resultPreview ?? payloads.result),
    overflow ? `${overflow.hidden}:${overflow.noun}:${overflow.direction}` : "",
    liveOutput?.updatedAt ?? "",
    liveOutput?.text.length ?? 0,
  ].join("\0");
}

/** Cached wrapper around {@link parseToolView}, keyed by tool-call revision. */
export function parseToolViewCached(
  toolCall: ToolCallDisplayRecord,
  liveOutput?: LiveToolOutput,
): ToolView {
  const key = toolViewSignature(toolCall, liveOutput);
  const cached = toolViewCache.get(key);
  if (cached !== undefined) return cached;
  const view = parseToolView(toolCall, liveOutput);
  toolViewCache.set(key, view);
  return view;
}

export function parseToolView(
  toolCall: ToolCallDisplayRecord,
  liveOutput?: LiveToolOutput,
): ToolView {
  const payloads = toolCall as ToolCallDisplayRecord & {
    args?: unknown;
    result?: unknown;
    argsPreview?: unknown;
    resultPreview?: unknown;
  };
  const rawArgs = payloads.argsPreview ?? payloads.args;
  const rawResult = payloads.resultPreview ?? payloads.result;
  const args = asRecord(rawArgs);
  const cwd = toolCall.cwd;
  const result = parseToolExecutionResult(rawResult);
  const outputLimits = outputLimitsFromDetails(result?.details);
  const outputArtifacts = outputArtifactsFromDetails(result?.details);

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
          outputLimits,
          outputArtifacts,
        };
      }
      const content = result?.content;
      const hasRange =
        typeof args.offset === "number" || typeof args.limit === "number";
      let lineLabel: string | undefined;
      const lineCount =
        content === undefined
          ? undefined
          : actualTextLineCount(
              content,
              toolCall,
              "lines",
              "head",
              outputLimits,
            );
      if (lineCount !== undefined) {
        if (hasRange && typeof args.offset === "number" && lineCount > 0) {
          const start = args.offset as number;
          lineLabel = `lines ${start}–${start + lineCount - 1}`;
        } else {
          lineLabel = `${lineCount} line${lineCount === 1 ? "" : "s"}`;
        }
      }
      return {
        kind: "read",
        path,
        relPath,
        lineLabel,
        lineCount,
        content,
        truncated: detailsTruncated(result?.details),
        outputLimits,
        outputArtifacts,
      };
    }

    case "bash": {
      const command = stringField(args.command);
      const details = bashResultDetailsSchema.safeParse(result?.details);
      const output = resultOutputText(result, rawResult, liveOutput);
      const outputLineCount = actualTextLineCount(
        output,
        toolCall,
        "lines",
        "tail",
        outputLimits,
      );
      return {
        kind: "bash",
        command,
        exitCode: result?.exitCode,
        signal: details.success
          ? (details.data.signal ?? undefined)
          : undefined,
        output,
        outputLineCount,
        savedTo: details.success ? details.data.fullOutputPath : undefined,
        truncated: detailsTruncated(result?.details),
        live: !result && Boolean(liveOutput?.text),
        outputLimits: liveOutput?.outputLimits
          ? { ...outputLimits, live: liveOutput.outputLimits }
          : outputLimits,
        outputArtifacts,
      };
    }

    case "python": {
      const code = stringField(args.code);
      const scriptInputPath = stringField(args.path);
      const details = pythonResultDetailsSchema.safeParse(result?.details);
      const detailScriptPath = details.success
        ? details.data.scriptPath
        : undefined;
      const scriptPath = resolveToolPath(
        detailScriptPath ?? scriptInputPath,
        cwd,
      );
      const output = resultOutputText(result, rawResult, liveOutput);
      const codeLineCount = code
        ? actualPreviewCount(countLines(code), toolCall, "lines", "head")
        : 0;
      const outputLineCount = actualTextLineCount(
        output,
        toolCall,
        "lines",
        "tail",
        outputLimits,
      );
      const inputMode = details.success
        ? (details.data.inputMode ?? (scriptPath ? "file" : "inline"))
        : scriptInputPath
          ? "file"
          : "inline";
      return {
        kind: "python",
        inputMode,
        code,
        codeLineCount,
        scriptPath,
        relScriptPath: relativePath(scriptPath, cwd),
        exitCode: result?.exitCode,
        signal: details.success
          ? (details.data.signal ?? undefined)
          : undefined,
        output,
        outputLineCount,
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
        outputLimits: liveOutput?.outputLimits
          ? { ...outputLimits, live: liveOutput.outputLimits }
          : outputLimits,
        outputArtifacts,
      };
    }

    case "edit": {
      const path = resolveToolPath(result?.path ?? stringField(args.path), cwd);
      const relPath = relativePath(path, cwd);
      const details = editOperationResultDetailsSchema.safeParse(
        result?.details,
      );
      const operations = details.success
        ? details.data.operationCount
        : editShorthandOperationCount(args);
      const diff = details.success ? details.data.diff : undefined;
      const diffLineCount = actualPreviewCount(
        countLines(diff),
        toolCall,
        "lines",
        "tail",
      );
      const { additions, deletions } = diffStats(diff);
      return {
        kind: "edit",
        path,
        relPath,
        operationCount: operations,
        additions,
        deletions,
        diff,
        diffLineCount,
        dryRun: details.success ? details.data.dryRun : undefined,
      };
    }

    case "write": {
      const path = resolveToolPath(result?.path ?? stringField(args.path), cwd);
      const relPath = relativePath(path, cwd);
      const content = stringField(args.content);
      const byteMatch = result?.content?.match(/Wrote (\d+) bytes/);
      const bytes = byteMatch ? Number(byteMatch[1]) : undefined;
      const lineCount =
        content === undefined
          ? undefined
          : actualPreviewCount(countLines(content), toolCall, "lines", "tail");
      const charCount = content?.length;
      return {
        kind: "write",
        path,
        relPath,
        bytes,
        lineCount,
        charCount,
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
        matchCount: actualPreviewCount(
          matches.length,
          toolCall,
          "matches",
          "head",
        ),
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
        count: actualPreviewCount(paths.length, toolCall, "files", "head"),
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
        total: actualPreviewCount(entries.length, toolCall, "entries", "head"),
      };
    }

    case "ask_user": {
      const parsed = askUserResultSchema.safeParse(rawResult);
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
      const parsed = todosResultSchema.safeParse(rawResult);
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

    case "task_start":
    case "task_cancel":
    case "task_restart": {
      const action = toolCall.toolName.replace("task_", "") as
        | "start"
        | "cancel"
        | "restart";
      const parsed = taskActionResultSchema.safeParse(rawResult);
      const task = parsed.success ? parsed.data.task : undefined;
      const tasks = parsed.success ? parsed.data.tasks : undefined;
      return {
        kind: "task_action",
        action,
        task,
        tasks,
      };
    }

    case "task_status": {
      const result = asRecord(rawResult);
      const rows = Array.isArray(result.tasks) ? result.tasks : [];
      const tasks = rows
        .map((row) => {
          const record = asRecord(row);
          return taskRecordSchema.safeParse(record.task ?? record);
        })
        .filter((parsed) => parsed.success)
        .map((parsed) => parsed.data);
      return {
        kind: "task_list",
        tasks,
      };
    }

    case "task_list": {
      const parsed = taskListResultSchema.safeParse(rawResult);
      const tasks = parsed.success ? parsed.data.tasks : [];
      return {
        kind: "task_list",
        tasks,
      };
    }

    case "task_logs": {
      const parsed = taskLogsResultSchema.safeParse(rawResult);
      const data = parsed.success ? parsed.data : undefined;
      const events = data?.events ?? [];
      return {
        kind: "task_logs",
        task: data?.task,
        events,
        eventCount: actualPreviewCount(
          events.length,
          toolCall,
          "events",
          "tail",
        ),
        mode: data?.mode,
      };
    }

    case "explore": {
      const parsed = exploreResultSchema.safeParse(rawResult);
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
      const resultRecord = asRecord(rawResult);
      const planDir = stringField(resultRecord.planDir);
      return {
        kind: "plan_mode",
        action: "enter",
        summary: firstTextBlock(rawResult),
        planPath: planDir,
      };
    }

    case "plan_mode_present": {
      const resultRecord = asRecord(rawResult);
      const review = asRecord(resultRecord.review);
      const planPath =
        stringField(review.planPath) ?? stringField(args.file_path);
      const outcome =
        stringField(resultRecord.outcome) ?? stringField(review.status);
      return {
        kind: "plan_mode",
        action: "present",
        summary:
          stringField(resultRecord.feedback) ?? firstTextBlock(rawResult),
        planPath,
        outcome,
      };
    }

    case "plan_mode_force_exit": {
      const resultRecord = asRecord(rawResult);
      const reason = stringField(resultRecord.reason);
      return {
        kind: "plan_mode",
        action: "force_exit",
        summary: reason,
      };
    }

    case "jira_search_users":
    case "jira_search_issues":
    case "jira_get_issue":
    case "jira_get_project":
    case "jira_create_issue":
    case "jira_update_issue":
    case "jira_add_comment":
    case "jira_transition_issue":
      return parseJiraView(toolCall, args, rawResult, liveOutput);

    case "confluence_search_spaces":
    case "confluence_search_pages":
    case "confluence_get_page":
    case "confluence_download_pages":
    case "confluence_create_page":
    case "confluence_update_page":
    case "confluence_publish_pages":
    case "confluence_upload_attachment":
      return parseConfluenceView(toolCall, args, rawResult, liveOutput);

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
        outputLimits,
        outputArtifacts,
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
        outputLimits,
        outputArtifacts,
      };
    }

    default:
      return { kind: "generic" };
  }
}
