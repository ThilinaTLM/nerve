import {
  askUserResultSchema,
  bashResultDetailsSchema,
  editResultDetailsSchema,
  exploreResultSchema,
  processActionResultSchema,
  processListResultSchema,
  processLogsResultSchema,
  pythonResultDetailsSchema,
  todosResultSchema,
  webFetchResultDetailsSchema,
  webSearchResultDetailsSchema,
} from "@nerve/shared";
import type { ToolCallRecord } from "$lib/api";
import type { LiveToolOutput } from "$lib/core/types/state-types";
import { parseExploreProgressLog } from "./explore-progress";
import {
  asRecord,
  detailsTruncated,
  diffStats,
  firstTextBlock,
  groupMatchesByFile,
  imageDataUrl,
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
