import type { StatusTone } from "@nervekit/ui-kit/display/status";
import { relativePathForDisplay } from "@nervekit/ui-kit/display/path-links";

import type { ConversationLiveToolDraftBlockSnapshot } from "$lib/presentation/view-models/conversation";

/** Canonical tool-draft content block; local alias for signature brevity. */
type ToolDraftBlock = ConversationLiveToolDraftBlockSnapshot;
import { draftArgsPreviewBody } from "./tool-draft-args-preview";
import {
  isKnownToolName,
  presentToolArguments,
  type ToolArgumentBody,
} from "../lifecycle/registry";
import { mergeDraftMeta, progressDraftBody } from "./tool-draft-body";
import { COLLAPSED_LINES, SLIDE_OVERSCAN_LINES } from "./tool-view-helpers";
import { toolArgumentSource } from "../lifecycle/argument-source";
import type { PrimaryArg } from "../../cards/card-presentation";
export { hasMeaningfulToolDraftBody } from "./tool-draft-body";

export type DraftMetaItem = {
  /** Stable identity shared with the lifecycle spec chip it previews. */
  key?: string;
  text: string;
  tone?: StatusTone;
  mono?: boolean;
};

export type ExecutionDraftKind = "bash" | "python";

export type ToolDraftSummary = {
  kind: "write" | "edit" | ExecutionDraftKind | "generic";
  toolName: string;
  path?: string;
  statusText: string;
  meta: DraftMetaItem[];
  lineCount?: number;
  operationCount?: number;
  generatedLineCount?: number;
  estimatedAdditions?: number;
  estimatedDeletions?: number;
  estimated?: boolean;
  preview?: string;
  previewLanguage?: "diff";
  command?: string;
  code?: string;
  codeLineCount?: number;
  inputMode?: "inline" | "file";
  inlineInput?: string;
  inputPreview?: string;
  inputLineCount?: number;
  language?: "bash" | "python";
  primaryArg?: PrimaryArg;
  argumentBody?: ToolArgumentBody;
  safetyNotes?: string[];
  done: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function plural(count: number, singular: string, suffix = "s"): string {
  return `${count} ${singular}${count === 1 ? "" : suffix}`;
}

function lineCount(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  if (text.length === 0) return 0;
  return text.split("\n").length;
}

function normalizeLines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

// Draft tails stream into collapsed boxes; overscan lines above the window
// are clipped by the box and keep the line slide gap-free.
function tailLinePreview(
  text: string,
  maxLines = COLLAPSED_LINES + SLIDE_OVERSCAN_LINES,
): string {
  if (text.length === 0) return "";
  const lines = normalizeLines(text).split("\n");
  if (lines.length <= maxLines) return lines.join("\n");
  return lines.slice(-maxLines).join("\n");
}

function isOneLine(text: string): boolean {
  return !normalizeLines(text).includes("\n");
}

function inlineInputPreview(text: string | undefined): {
  inlineInput?: string;
  inputPreview?: string;
  inputLineCount?: number;
} {
  if (text === undefined || text.length === 0) return {};
  const normalized = normalizeLines(text);
  const inputLineCount = lineCount(normalized);
  if (isOneLine(normalized)) {
    return { inlineInput: normalized, inputLineCount };
  }
  return {
    inputPreview: tailLinePreview(normalized),
    inputLineCount,
  };
}

function firstPathFromDraft(
  draft: ToolDraftBlock,
  cwd?: string,
): string | undefined {
  const args = asRecord(draft.args);
  const path =
    stringField(args.path) ??
    draft.progress?.path ??
    toolArgumentSource(draft).string("path");
  if (path && cwd) return relativePathForDisplay(path, cwd) ?? path;
  return path;
}

function summarizeWriteDraft(
  draft: ToolDraftBlock,
  cwd?: string,
): ToolDraftSummary {
  const args = asRecord(draft.args);
  const finalContent = stringField(args.content);
  const source = toolArgumentSource(draft);
  const content = source.string("content");
  const lines =
    source.stringMetrics("content")?.lines ??
    draft.progress?.lineCount ??
    draft.progress?.generatedLineCount;
  const preview =
    content === undefined && draft.progress?.generatedPreview
      ? tailLinePreview(draft.progress.generatedPreview)
      : undefined;
  const estimated =
    finalContent === undefined && Boolean(draft.progress?.estimated);
  // Same key and text as the write lifecycle spec, so the chip stays one
  // element from the first drafted line through completion.
  const meta: DraftMetaItem[] = [];
  if (lines !== undefined && lines > 0) {
    meta.push({ key: "write-lines", text: plural(lines, "line") });
  }
  return {
    kind: "write",
    toolName: "write",
    path: firstPathFromDraft(draft, cwd),
    statusText: draft.done ? "Submitting" : "Generating",
    meta,
    lineCount: lines,
    generatedLineCount: lines,
    estimated,
    preview,
    done: Boolean(draft.done),
  };
}

type EditDraftStats = {
  operations: number;
  generatedLines: number;
  estimatedAdditions?: number;
  estimatedDeletions?: number;
  estimated: boolean;
};

function arrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function finalEditStats(
  args: Record<string, unknown>,
): EditDraftStats | undefined {
  if (!Array.isArray(args.edits)) return undefined;

  let additions = 0;
  let deletions = 0;
  const edits = arrayField(args.edits);
  const operations = edits.length;
  for (const edit of edits) {
    const record = asRecord(edit);
    additions += lineCount(stringField(record.newText)) ?? 0;
    deletions += lineCount(stringField(record.oldText)) ?? 0;
  }

  return {
    operations,
    generatedLines: additions,
    estimatedAdditions: additions,
    estimatedDeletions: deletions,
    estimated: false,
  };
}

function progressEditStats(draft: ToolDraftBlock): EditDraftStats | undefined {
  const progress = draft.progress;
  if (!progress) return undefined;
  return {
    operations: progress.operationCount ?? 0,
    generatedLines: progress.generatedLineCount ?? 0,
    estimatedAdditions: progress.estimatedAdditions,
    estimatedDeletions: progress.estimatedDeletions,
    estimated: progress.estimated,
  };
}

function partialEditStats(argsText: string): EditDraftStats | undefined {
  const edits = toolArgumentSource({ argsText }).objectArraySources(
    "edits",
    Infinity,
  );
  if (!edits.length) return undefined;
  const additions = edits.reduce(
    (total, edit) => total + (edit.stringMetrics("newText")?.lines ?? 0),
    0,
  );
  const deletions = edits.reduce(
    (total, edit) => total + (edit.stringMetrics("oldText")?.lines ?? 0),
    0,
  );
  return {
    operations: edits.length,
    generatedLines: additions,
    estimatedAdditions: additions,
    estimatedDeletions: deletions,
    estimated: true,
  };
}

function summarizeEditDraft(
  draft: ToolDraftBlock,
  cwd?: string,
): ToolDraftSummary {
  const args = asRecord(draft.args);
  const finalStats = finalEditStats(args);
  const partialStats = draft.argsText
    ? partialEditStats(draft.argsText)
    : undefined;
  const progressStats = progressEditStats(draft);
  const stats = finalStats ??
    partialStats ??
    progressStats ?? {
      operations: 0,
      generatedLines: 0,
      estimated: false,
    };
  const preview =
    !finalStats && !partialStats && draft.progress?.generatedPreview
      ? tailLinePreview(draft.progress.generatedPreview)
      : undefined;
  // Same keys and text as the edit lifecycle spec (`add`/`del`, appearing
  // together) so the counters persist and only count up across the handoff.
  const meta: DraftMetaItem[] = [];
  const additions = stats.estimatedAdditions ?? stats.generatedLines;
  const deletions = stats.estimatedDeletions ?? 0;
  if (stats.operations > 0 || additions > 0) {
    meta.push({ key: "add", text: `+${additions}`, tone: "success" });
    meta.push({ key: "del", text: `−${deletions}`, tone: "destructive" });
  }
  return {
    kind: "edit",
    toolName: "edit",
    path: firstPathFromDraft(draft, cwd),
    statusText: draft.done ? "Submitting" : "Generating",
    meta,
    operationCount: stats.operations,
    generatedLineCount: stats.generatedLines,
    estimatedAdditions: stats.estimatedAdditions,
    estimatedDeletions: stats.estimatedDeletions,
    estimated: stats.estimated,
    preview,
    previewLanguage: preview ? "diff" : undefined,
    done: Boolean(draft.done),
  };
}

function summarizeBashDraft(draft: ToolDraftBlock): ToolDraftSummary {
  const args = asRecord(draft.args);
  const finalCommand = stringField(args.command);
  const partialCommand = toolArgumentSource(draft).string("command");
  const command = finalCommand ?? partialCommand;
  const input = inlineInputPreview(command);
  const commandLineCount =
    toolArgumentSource(draft).stringMetrics("command")?.lines;
  const hasCommand = command !== undefined && command.length > 0;
  const meta: DraftMetaItem[] = [];
  if (commandLineCount !== undefined && commandLineCount > 1) {
    meta.push({ text: plural(commandLineCount, "command line"), tone: "info" });
  }
  return {
    kind: "bash",
    toolName: "bash",
    statusText: hasCommand
      ? draft.done
        ? "Submitting command…"
        : "Generating command…"
      : "Waiting for command…",
    meta,
    command,
    inputMode: "inline",
    ...input,
    language: "bash",
    done: Boolean(draft.done),
  };
}

function summarizePythonDraft(
  draft: ToolDraftBlock,
  cwd?: string,
): ToolDraftSummary {
  const args = asRecord(draft.args);
  const path = firstPathFromDraft(draft, cwd);
  const finalCode = stringField(args.code);
  const partialCode = toolArgumentSource(draft).string("code");
  const code = finalCode ?? partialCode;
  const input = inlineInputPreview(code);
  const codeLineCount = toolArgumentSource(draft).stringMetrics("code")?.lines;
  const hasCode = code !== undefined && code.length > 0;
  const hasPath = path !== undefined && path.length > 0;
  const inputMode = hasPath && !hasCode ? "file" : "inline";
  const meta: DraftMetaItem[] = [];
  if (codeLineCount !== undefined && codeLineCount > 0) {
    meta.push({ text: plural(codeLineCount, "code line"), tone: "info" });
  }
  if (hasPath && !hasCode) meta.push({ text: "file", tone: "info" });
  return {
    kind: "python",
    toolName: "python_exec",
    path: inputMode === "file" ? path : undefined,
    statusText:
      inputMode === "file"
        ? draft.done
          ? "Submitting Python file…"
          : "Preparing Python file…"
        : hasCode
          ? draft.done
            ? "Submitting Python code…"
            : "Generating Python code…"
          : "Waiting for Python code or path…",
    meta,
    code,
    codeLineCount,
    inputMode,
    ...input,
    language: "python",
    done: Boolean(draft.done),
  };
}

function withLifecyclePresentation(
  summary: ToolDraftSummary,
  draft: ToolDraftBlock,
  cwd?: string,
): ToolDraftSummary {
  const toolName = draft.toolName ?? "tool";
  const presentation = presentToolArguments(
    toolName,
    { args: draft.args, argsText: draft.argsText },
    "drafting",
    cwd,
  );
  const progressBody = progressDraftBody(summary);
  // Unknown historical tools stream raw JSON as their argument body so the
  // card can render one persistent argument section for every tool.
  const fallbackBody =
    presentation.body.kind !== "none"
      ? presentation.body
      : !isKnownToolName(toolName)
        ? draftArgsPreviewBody(draft, {
            maxLines: COLLAPSED_LINES + SLIDE_OVERSCAN_LINES,
            maxChars: 24_000,
          })
        : undefined;
  return {
    ...summary,
    path: summary.path ?? presentation.primaryArg?.text,
    primaryArg: presentation.primaryArg,
    meta: mergeDraftMeta(summary.meta, presentation.secondary),
    argumentBody: fallbackBody ?? progressBody ?? presentation.body,
    safetyNotes: presentation.safetyNotes,
  };
}

export function summarizeToolDraft(
  draft: ToolDraftBlock,
  cwd?: string,
): ToolDraftSummary {
  if (draft.toolName === "write") {
    return withLifecyclePresentation(
      summarizeWriteDraft(draft, cwd),
      draft,
      cwd,
    );
  }
  if (draft.toolName === "edit") {
    return withLifecyclePresentation(
      summarizeEditDraft(draft, cwd),
      draft,
      cwd,
    );
  }
  if (draft.toolName === "bash") {
    return withLifecyclePresentation(summarizeBashDraft(draft), draft, cwd);
  }
  if (draft.toolName === "python_exec") {
    return withLifecyclePresentation(
      summarizePythonDraft(draft, cwd),
      draft,
      cwd,
    );
  }
  const toolName = draft.toolName ?? "tool";
  const presentation = presentToolArguments(
    toolName,
    { args: draft.args, argsText: draft.argsText },
    "drafting",
    cwd,
  );
  return withLifecyclePresentation(
    {
      kind: "generic",
      toolName,
      path: presentation.primaryArg?.text,
      statusText: draft.done
        ? `${toolName} arguments prepared.`
        : `Preparing ${toolName} arguments…`,
      meta: presentation.secondary,
      primaryArg: presentation.primaryArg,
      argumentBody: presentation.body,
      safetyNotes: presentation.safetyNotes,
      done: Boolean(draft.done),
    },
    draft,
    cwd,
  );
}
