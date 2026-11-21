import {
  bashResultDetailsSchema,
  quickScriptArtifactSchema,
  quickScriptResultDetailsSchema,
  writeResultDetailsSchema,
  grepResultDetailsSchema,
  findResultDetailsSchema,
  editOperationResultDetailsSchema,
  pythonResultDetailsSchema,
  webFetchResultDetailsSchema,
} from "@nervekit/contracts/tools";
import { extensionToolResultDetailsSchema } from "@nervekit/contracts/extensions";
import type {
  ToolCallRecord,
  ToolCallTranscriptRecord,
} from "../../state/tool-types";
export type ToolCallDisplayRecord = ToolCallRecord | ToolCallTranscriptRecord;

import { LruCache } from "@nervekit/ui-kit/collections/lru-cache";

import type { ConversationLiveToolOutputSnapshot } from "$lib/presentation/view-models/conversation";
import {
  redactStructuredValue,
  toolArgumentSource,
} from "../lifecycle/argument-source";
import { askUserViewFromCall } from "../tool-call/ask-user-state";
import { liveQuickScriptCalls } from "./quick-script-calls";
import {
  parseStatusDetail,
  parseStatusListing,
  parseStopResult,
  subagentAssignments,
} from "./subagent-result-parser";
import {
  asRecord,
  countLogicalLines,
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
  trimMatchText,
} from "./tool-view-helpers";
import type { ExtensionSectionView, ToolView } from "./tool-view-types";
import { extensionToolView } from "../lifecycle/extension-tools";

// Re-export the supporting modules so existing consumers that import from this
// file (via tool-result-view) keep a single, stable surface.
export {
  COLLAPSED_LINES,
  splitLogicalLines,
  tailLogicalText,
} from "./tool-view-helpers";
export type { GroupedMatches, ToolView } from "./tool-view-types";

function arrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function editOperationCount(args: Record<string, unknown>): number {
  return arrayField(args.edits).length;
}

function nonnegativeIntegerField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
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
    actualPreviewCount(countLogicalLines(text), toolCall, noun, direction)
  );
}

// Memoize the (zod-heavy) tool-result projection. parseToolView re-runs on
// every card mount (tab switch / scroll into view) and on every live
// `tool_call.updated`; caching by tool-call identity + revision lets stable
// cards reuse the parsed view instead of re-running schema parsing.
const toolViewCache = new LruCache<string, ToolView>(300);

// Payload objects are treated as immutable; identity (a stable per-object id)
// keys the cache instead of serializing the whole value on every lookup.
const payloadIds = new WeakMap<object, number>();
let nextPayloadId = 1;

function payloadSignature(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return `s:${value.length}`;
  if (typeof value === "object" && value !== null) {
    let id = payloadIds.get(value);
    if (id === undefined) {
      id = nextPayloadId++;
      payloadIds.set(value, id);
    }
    return `o:${id}`;
  }
  return `p:${String(value)}`;
}

function toolViewSignature(
  toolCall: ToolCallDisplayRecord,
  liveOutput?: ConversationLiveToolOutputSnapshot,
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
    liveOutput?.chunks.length ?? 0,
    extensionToolView(toolCall.toolName) ? "extension" : "",
  ].join("\0");
}

/** Cached wrapper around {@link parseToolView}, keyed by tool-call revision. */
export function parseToolViewCached(
  toolCall: ToolCallDisplayRecord,
  liveOutput?: ConversationLiveToolOutputSnapshot,
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
  liveOutput?: ConversationLiveToolOutputSnapshot,
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
            dataUrl:
              "assetId" in imageBlock
                ? `/api/assets/${encodeURIComponent(imageBlock.assetId)}`
                : imageDataUrl(imageBlock.mimeType, imageBlock.data),
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

    case "quick_script": {
      const details = quickScriptResultDetailsSchema.safeParse(result?.details);
      // While running, the live stream carries SDK-call rows, never script output.
      const liveCalls = result ? [] : liveQuickScriptCalls(liveOutput);
      return {
        kind: "quick_script",
        code: stringField(args.code),
        output: resultOutputText(result, rawResult),
        status: details.success ? details.data.status : undefined,
        error: details.success ? details.data.error : undefined,
        durationMs: details.success ? details.data.durationMs : undefined,
        outputTruncated: details.success
          ? details.data.outputTruncated
          : undefined,
        hostCalls: details.success ? details.data.hostCalls : liveCalls,
        liveCalls: !details.success && liveCalls.length > 0,
        plannedOperations:
          ("supervision" in toolCall
            ? toolCall.supervision?.operations
            : undefined) ?? [],
        artifacts: details.success ? (details.data.artifacts ?? []) : [],
        created: details.success ? (details.data.created ?? []) : [],
      };
    }

    case "async_bash":
    case "launch":
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
        exitCode:
          result?.exitCode ??
          (details.success && typeof details.data.exitCode === "number"
            ? details.data.exitCode
            : undefined),
        signal: details.success
          ? (details.data.signal ?? undefined)
          : undefined,
        backgroundTask:
          details.success &&
          details.data.execution?.disposition === "backgrounded"
            ? {
                taskId: details.data.execution.taskId,
                status: details.data.execution.status,
                elapsedMs: details.data.execution.elapsedMs,
                terminalUpdate: details.data.execution.terminalUpdate,
              }
            : undefined,
        output,
        outputLineCount,
        savedTo: details.success ? details.data.fullOutputPath : undefined,
        truncated: detailsTruncated(result?.details),
        live: !result && Boolean(liveOutput?.text),
        outputLimits: liveOutput?.outputLimits
          ? { ...outputLimits, live: { ...liveOutput.outputLimits } }
          : outputLimits,
        outputArtifacts,
      };
    }

    case "python":
    case "python_exec": {
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
        ? actualPreviewCount(countLogicalLines(code), toolCall, "lines", "head")
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
          ? { ...outputLimits, live: { ...liveOutput.outputLimits } }
          : outputLimits,
        outputArtifacts,
      };
    }

    case "edit": {
      const path = resolveToolPath(result?.path ?? stringField(args.path), cwd);
      const relPath = relativePath(path, cwd);
      const rawDetails = asRecord(result?.details);
      const details = editOperationResultDetailsSchema.safeParse(rawDetails);
      const operationCount = details.success
        ? details.data.operationCount
        : (nonnegativeIntegerField(rawDetails.operationCount) ??
          editOperationCount(args));
      const diff = details.success
        ? details.data.diff
        : stringField(rawDetails.diff);
      const diffLineCount = actualPreviewCount(
        countLogicalLines(diff),
        toolCall,
        "lines",
        "tail",
      );
      const { additions, deletions } = diffStats(diff);
      return {
        kind: "edit",
        path,
        relPath,
        operationCount,
        operations: Array.isArray(rawDetails.operations)
          ? rawDetails.operations.flatMap((value, index) => {
              const op = asRecord(value);
              const status = op.status;
              return status === "applied" ||
                status === "failed" ||
                status === "not_applied"
                ? [
                    {
                      index:
                        nonnegativeIntegerField(op.sourceIndex) ??
                        nonnegativeIntegerField(op.index) ??
                        index,
                      status,
                      error: stringField(op.error),
                    },
                  ]
                : [];
            })
          : undefined,
        appliedCount: details.success
          ? details.data.appliedCount
          : nonnegativeIntegerField(rawDetails.appliedCount),
        additions,
        deletions,
        diff,
        diffLineCount,
        dryRun: details.success
          ? details.data.dryRun
          : typeof rawDetails.dryRun === "boolean"
            ? rawDetails.dryRun
            : undefined,
      };
    }

    case "write": {
      const path = resolveToolPath(result?.path ?? stringField(args.path), cwd);
      const relPath = relativePath(path, cwd);
      const content = stringField(args.content);
      const byteMatch = result?.content?.match(/Wrote (\d+) bytes/);
      const structured = writeResultDetailsSchema.safeParse(result?.details);
      const bytes =
        (structured.success ? structured.data.bytes : undefined) ??
        (byteMatch ? Number(byteMatch[1]) : undefined);
      const lineCount =
        content === undefined
          ? undefined
          : actualPreviewCount(
              countLogicalLines(content),
              toolCall,
              "lines",
              "tail",
            );
      const charCount = content?.length;
      return {
        kind: "write",
        outcome: structured.success ? structured.data.outcome : undefined,
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
      const structured = grepResultDetailsSchema.safeParse(result?.details);
      const totals = structured.success ? structured.data : {};
      return {
        kind: "grep",
        pattern,
        totalMatches: totals.totalMatches,
        totalFiles: totals.totalFiles,
        matchCount:
          totals.totalMatches ??
          actualPreviewCount(matches.length, toolCall, "matches", "head"),
        fileCount: totals.totalFiles ?? all.length,
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
        totalEntries: findResultDetailsSchema.safeParse(result?.details).data
          ?.totalEntries,
        count:
          findResultDetailsSchema.safeParse(result?.details).data
            ?.totalEntries ??
          actualPreviewCount(paths.length, toolCall, "files", "head"),
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
        totalEntries: findResultDetailsSchema.safeParse(result?.details).data
          ?.totalEntries,
        total:
          findResultDetailsSchema.safeParse(result?.details).data
            ?.totalEntries ??
          actualPreviewCount(entries.length, toolCall, "entries", "head"),
      };
    }

    case "ask_user": {
      return { kind: "ask_user", ...askUserViewFromCall(args, rawResult) };
    }

    case "subagent_prompt": {
      const context = stringField(args.context)?.trim();
      return {
        kind: "subagent",
        action: "prompt",
        context: context || undefined,
        assignments: subagentAssignments(
          args,
          resultOutputText(result, rawResult),
          result?.details,
        ),
      };
    }

    case "subagent_status": {
      const name = stringField(args.name);
      const text = resultOutputText(result, rawResult);
      return {
        kind: "subagent",
        action: "status",
        name,
        rows: parseStatusListing(text, result?.details),
        ...(name ? parseStatusDetail(text) : {}),
      };
    }

    case "subagent_stop": {
      const names = arrayField(args.names).filter(
        (name): name is string => typeof name === "string",
      );
      return {
        kind: "subagent",
        action: "stop",
        names,
        lines: parseStopResult(
          resultOutputText(result, rawResult),
          result?.details,
        ),
      };
    }

    case "plan_present": {
      const resultRecord = asRecord(rawResult);
      const review = asRecord(
        resultRecord.review ?? asRecord(resultRecord.details).review,
      );
      const interactionSummary =
        toolCall.interaction?.kind === "plan_review"
          ? toolCall.interaction.request.summary
          : undefined;
      const planPath =
        stringField(review.planPath) ?? stringField(args.file_path);
      const outcome =
        stringField(resultRecord.outcome) ?? stringField(review.status);
      return {
        kind: "plan_present",
        action: "present",
        summary:
          stringField(resultRecord.feedback) ?? firstTextBlock(rawResult),
        planPreview:
          stringField(review.content) ??
          stringField(review.summary) ??
          interactionSummary,
        planPath,
        outcome,
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

    default: {
      // A direct tool of an extension: its stored result lists the sections to
      // render; while it runs, its declared live sections show streamed text.
      const declared = extensionToolView(toolCall.toolName);
      const extensionResult = extensionToolResultDetailsSchema.safeParse(
        result?.details,
      );
      if (extensionResult.success || (declared && !result)) {
        const details = extensionResult.success
          ? extensionResult.data
          : undefined;
        const running = !details && toolCall.status === "running";
        const sections: ExtensionSectionView[] = details
          ? details.sections.map((section) => ({
              id: section.id,
              type: section.type,
              ...(section.label ? { label: section.label } : {}),
              value: section.value,
            }))
          : running && declared && liveOutput
            ? declared.sections.flatMap((section) => {
                if (!section.live) return [];
                const text = liveOutput.chunks
                  .filter((chunk) => chunk.stream === section.id)
                  .map((chunk) => chunk.text)
                  .join("");
                return text
                  ? [
                      {
                        id: section.id,
                        type: section.type,
                        ...(section.label ? { label: section.label } : {}),
                        value: text,
                        live: true,
                      },
                    ]
                  : [];
              })
            : [];
        const artifacts = quickScriptArtifactSchema
          .array()
          .safeParse(details?.artifacts);
        return {
          kind: "extension",
          toolName: toolCall.toolName,
          extension: details?.extension ?? "",
          sections,
          live: sections.some((section) => section.live),
          artifacts: artifacts.success ? artifacts.data : [],
          resultText: details
            ? resultOutputText(result, rawResult, liveOutput)
            : undefined,
        };
      }
      const resultText = resultOutputText(result, rawResult, liveOutput);
      const safeResultText = resultText
        ? redactStructuredValue("result", resultText).slice(0, 6_000)
        : undefined;
      return {
        kind: "generic",
        toolName: toolCall.toolName,
        args: toolArgumentSource({ args: rawArgs }).structuredEntries(),
        result: toolArgumentSource({ args: rawResult }).structuredEntries(),
        resultText: safeResultText,
      };
    }
  }
}
