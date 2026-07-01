import type { LiveToolCallDraft } from "$lib/core/types/state-types";
import { relativePathForDisplay } from "$lib/core/utils/path-links";
import {
  confluenceDraftMeta,
  confluenceDraftPrimaryArg,
} from "./confluence-draft-progress";
import { jiraDraftMeta, jiraDraftPrimaryArg } from "./jira-draft-progress";
import { draftArgsPreview } from "./tool-draft-args-preview";

export type DraftMetaTone =
  | "default"
  | "success"
  | "warning"
  | "error"
  | "info";

export type DraftMetaItem = {
  text: string;
  tone?: DraftMetaTone;
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
  argsPreview?: string;
  argsPreviewLanguage?: "json";
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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function propertyValuePattern(property: string): RegExp {
  return new RegExp(`"${escapeRegExp(property)}"\\s*:\\s*"`, "g");
}

function extractJsonStringValues(
  text: string,
  property: string,
  options: { maxChars?: number } = {},
): string[] {
  const values: string[] = [];
  const pattern = propertyValuePattern(property);
  let match = pattern.exec(text);
  while (match) {
    const maxChars = options.maxChars ?? Number.POSITIVE_INFINITY;
    let value = "";
    let index = match.index + match[0].length;
    while (index < text.length) {
      const char = text[index];
      if (char === "\\") {
        if (index + 1 >= text.length) break;
        const escaped = text[index + 1];
        if (value.length < maxChars) {
          if (escaped === "n") value += "\n";
          else if (escaped === "r") value += "\r";
          else if (escaped === "t") value += "\t";
          else value += escaped;
        }
        index += 2;
        continue;
      }
      if (char === '"') break;
      if (value.length < maxChars) value += char;
      index += 1;
    }
    values.push(value);
    match = pattern.exec(text);
  }
  return values;
}

function lineCountsForJsonStringValues(
  text: string,
  property: string,
): number[] {
  const counts: number[] = [];
  const pattern = propertyValuePattern(property);
  let match = pattern.exec(text);
  while (match) {
    let lines = 0;
    let sawContent = false;
    let index = match.index + match[0].length;
    while (index < text.length) {
      const char = text[index];
      if (char === "\\") {
        if (index + 1 >= text.length) break;
        const escaped = text[index + 1];
        if (escaped === "n") {
          lines = Math.max(lines, 1) + 1;
          sawContent = true;
        } else if (escaped !== "r") {
          sawContent = true;
        }
        index += 2;
        continue;
      }
      if (char === '"') break;
      if (char === "\n") {
        lines = Math.max(lines, 1) + 1;
      } else if (char !== "\r") {
        sawContent = true;
      }
      index += 1;
    }
    counts.push(Math.max(lines, sawContent ? 1 : 0));
    match = pattern.exec(text);
  }
  return counts;
}

export const DRAFT_PREVIEW_LINES = 10;
const DRAFT_PREVIEW_MAX_VALUE_CHARS = 24_000;

type JsonStringEntry<Property extends string = string> = {
  property: Property;
  value: string;
  complete: boolean;
  index: number;
};

function decodeJsonEscape(char: string): string {
  if (char === "n") return "\n";
  if (char === "r") return "\r";
  if (char === "t") return "\t";
  return char;
}

function appendTail(text: string, char: string, maxChars: number): string {
  if (text.length + char.length <= maxChars) return text + char;
  return `${text}${char}`.slice(-maxChars);
}

function propertyAlternationPattern(properties: readonly string[]): RegExp {
  return new RegExp(
    `"(${properties.map(escapeRegExp).join("|")})"\\s*:\\s*"`,
    "g",
  );
}

function extractJsonStringEntries<const Property extends string>(
  text: string,
  properties: readonly Property[],
  options: { maxChars?: number } = {},
): JsonStringEntry<Property>[] {
  if (properties.length === 0) return [];
  const values: JsonStringEntry<Property>[] = [];
  const pattern = propertyAlternationPattern(properties);
  let match = pattern.exec(text);
  while (match) {
    const maxChars = options.maxChars ?? DRAFT_PREVIEW_MAX_VALUE_CHARS;
    let value = "";
    let complete = false;
    let index = match.index + match[0].length;
    while (index < text.length) {
      const char = text[index];
      if (char === "\\") {
        if (index + 1 >= text.length) break;
        value = appendTail(value, decodeJsonEscape(text[index + 1]), maxChars);
        index += 2;
        continue;
      }
      if (char === '"') {
        complete = true;
        break;
      }
      value = appendTail(value, char, maxChars);
      index += 1;
    }
    values.push({
      property: match[1] as Property,
      value,
      complete,
      index: match.index,
    });
    match = pattern.exec(text);
  }
  return values.sort((a, b) => a.index - b.index);
}

function normalizeLines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function completedLinePreviewText(
  text: string,
  includeTrailingLine: boolean,
): string {
  const normalized = normalizeLines(text);
  if (includeTrailingLine) return normalized;
  const lastNewline = normalized.lastIndexOf("\n");
  if (lastNewline < 0) return "";
  return normalized.slice(0, lastNewline);
}

function tailLinePreview(text: string, maxLines = DRAFT_PREVIEW_LINES): string {
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

function previewFromTexts(texts: string[]): string | undefined {
  const text = texts.filter((part) => part.length > 0).join("\n");
  return text.length > 0 ? tailLinePreview(text) : undefined;
}

type DiffPreviewPart = {
  text: string;
  kind: "added" | "removed" | "patch";
  complete: boolean;
};

function prefixDiffLines(text: string, prefix: "+" | "-"): string {
  const normalized = normalizeLines(text);
  if (normalized.length === 0) return "";
  return normalized
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function diffPreviewFromParts(
  parts: DiffPreviewPart[],
  includeActiveTrailingLine: boolean,
): string | undefined {
  const preview = previewFromTexts(
    parts.map((part) => {
      const text = completedLinePreviewText(
        part.text,
        part.complete || includeActiveTrailingLine,
      );
      if (part.kind === "patch") return text;
      return prefixDiffLines(text, part.kind === "added" ? "+" : "-");
    }),
  );
  return preview;
}

function previewFromJsonEntries(
  entries: JsonStringEntry[],
  includeActiveTrailingLine: boolean,
): string | undefined {
  return previewFromTexts(
    entries.map((entry) =>
      completedLinePreviewText(
        entry.value,
        entry.complete || includeActiveTrailingLine,
      ),
    ),
  );
}

function firstPathFromDraft(
  draft: LiveToolCallDraft,
  cwd?: string,
): string | undefined {
  const args = asRecord(draft.args);
  const path =
    stringField(args.path) ??
    draft.progress?.path ??
    extractJsonStringValues(draft.argsText, "path", { maxChars: 240 })[0];
  if (path && cwd) return relativePathForDisplay(path, cwd) ?? path;
  return path;
}

function summarizeWriteDraft(
  draft: LiveToolCallDraft,
  cwd?: string,
): ToolDraftSummary {
  const args = asRecord(draft.args);
  const finalContent = stringField(args.content);
  const partialContentLines = draft.argsText
    ? lineCountsForJsonStringValues(draft.argsText, "content")[0]
    : undefined;
  const progressLines =
    draft.progress?.lineCount ?? draft.progress?.generatedLineCount;
  const lines = lineCount(finalContent) ?? partialContentLines ?? progressLines;
  const progressPreview = draft.progress?.generatedPreview
    ? tailLinePreview(draft.progress.generatedPreview)
    : undefined;
  const preview =
    finalContent !== undefined
      ? previewFromTexts([normalizeLines(finalContent)])
      : ((draft.argsText
          ? previewFromJsonEntries(
              extractJsonStringEntries(draft.argsText, ["content"] as const),
              Boolean(draft.done),
            )
          : undefined) ?? progressPreview);
  const estimated =
    finalContent === undefined && Boolean(draft.progress?.estimated);
  const meta: DraftMetaItem[] = [];
  if (lines !== undefined && lines > 0) {
    meta.push({ text: `+${lines}`, tone: "success" });
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

function patchLineStats(patch: string): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

function arrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function finalEditStats(
  args: Record<string, unknown>,
): EditDraftStats | undefined {
  if (
    !Array.isArray(args.replacements) &&
    !Array.isArray(args.insertions) &&
    !Array.isArray(args.lineReplacements) &&
    !Array.isArray(args.lineInsertions) &&
    typeof args.patch !== "string"
  ) {
    return undefined;
  }

  let operations = 0;
  let additions = 0;
  let deletions = 0;

  const replacements = arrayField(args.replacements);
  operations += replacements.length;
  for (const replacement of replacements) {
    const record = asRecord(replacement);
    additions += lineCount(stringField(record.newText)) ?? 0;
    deletions += lineCount(stringField(record.oldText)) ?? 0;
  }

  const insertions = arrayField(args.insertions);
  operations += insertions.length;
  for (const insertion of insertions) {
    additions += lineCount(stringField(asRecord(insertion).text)) ?? 0;
  }

  const lineReplacements = arrayField(args.lineReplacements);
  operations += lineReplacements.length;
  for (const replacement of lineReplacements) {
    additions += lineCount(stringField(asRecord(replacement).newText)) ?? 0;
  }

  const lineInsertions = arrayField(args.lineInsertions);
  operations += lineInsertions.length;
  for (const insertion of lineInsertions) {
    additions += lineCount(stringField(asRecord(insertion).text)) ?? 0;
  }

  const patch = stringField(args.patch);
  if (patch) {
    operations += 1;
    const patchStats = patchLineStats(patch);
    additions += patchStats.additions;
    deletions += patchStats.deletions;
  }

  return {
    operations,
    generatedLines: additions,
    estimatedAdditions: additions,
    estimatedDeletions: deletions,
    estimated: false,
  };
}

function finalEditPreview(args: Record<string, unknown>): {
  preview?: string;
  previewLanguage?: "diff";
} {
  const parts: DiffPreviewPart[] = [];

  for (const replacement of arrayField(args.replacements)) {
    const record = asRecord(replacement);
    const oldText = stringField(record.oldText);
    const newText = stringField(record.newText);
    if (oldText !== undefined) {
      parts.push({ text: oldText, kind: "removed", complete: true });
    }
    if (newText !== undefined) {
      parts.push({ text: newText, kind: "added", complete: true });
    }
  }
  for (const insertion of arrayField(args.insertions)) {
    const text = stringField(asRecord(insertion).text);
    if (text !== undefined) parts.push({ text, kind: "added", complete: true });
  }
  for (const replacement of arrayField(args.lineReplacements)) {
    const text = stringField(asRecord(replacement).newText);
    if (text !== undefined) parts.push({ text, kind: "added", complete: true });
  }
  for (const insertion of arrayField(args.lineInsertions)) {
    const text = stringField(asRecord(insertion).text);
    if (text !== undefined) parts.push({ text, kind: "added", complete: true });
  }
  const patch = stringField(args.patch);
  if (patch !== undefined)
    parts.push({ text: patch, kind: "patch", complete: true });

  const preview = diffPreviewFromParts(parts, true);
  return { preview, previewLanguage: preview ? "diff" : undefined };
}

function partialEditPreview(
  argsText: string,
  done: boolean,
): { preview?: string; previewLanguage?: "diff" } {
  const entries = extractJsonStringEntries(argsText, [
    "oldText",
    "newText",
    "text",
    "patch",
  ] as const);
  const preview = diffPreviewFromParts(
    entries.map((entry) => ({
      text: entry.value,
      kind:
        entry.property === "oldText"
          ? "removed"
          : entry.property === "patch"
            ? "patch"
            : "added",
      complete: entry.complete,
    })),
    done,
  );
  return { preview, previewLanguage: preview ? "diff" : undefined };
}

function progressEditStats(
  draft: LiveToolCallDraft,
): EditDraftStats | undefined {
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

function partialEditStats(argsText: string): EditDraftStats {
  const oldTextLines = lineCountsForJsonStringValues(argsText, "oldText");
  const newTextLines = lineCountsForJsonStringValues(argsText, "newText");
  const insertedTextLines = lineCountsForJsonStringValues(argsText, "text");
  const patches = extractJsonStringValues(argsText, "patch", {
    maxChars: 24_000,
  });
  const patchStats = patches.reduce(
    (total, patch) => {
      const stats = patchLineStats(patch);
      return {
        additions: total.additions + stats.additions,
        deletions: total.deletions + stats.deletions,
      };
    },
    { additions: 0, deletions: 0 },
  );
  const additions =
    newTextLines.reduce((total, count) => total + count, 0) +
    insertedTextLines.reduce((total, count) => total + count, 0) +
    patchStats.additions;
  const deletions =
    oldTextLines.reduce((total, count) => total + count, 0) +
    patchStats.deletions;
  return {
    operations:
      Math.max(oldTextLines.length, newTextLines.length) +
      insertedTextLines.length +
      patches.length,
    generatedLines: additions,
    estimatedAdditions: additions,
    estimatedDeletions: deletions,
    estimated: true,
  };
}

function summarizeEditDraft(
  draft: LiveToolCallDraft,
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
  const progressPreviewDetails = draft.progress?.generatedPreview
    ? {
        preview: tailLinePreview(draft.progress.generatedPreview),
        previewLanguage: draft.progress.generatedPreviewLanguage,
      }
    : {};
  const partialPreviewDetails = draft.argsText
    ? partialEditPreview(draft.argsText, Boolean(draft.done))
    : undefined;
  const previewDetails = finalStats
    ? finalEditPreview(args)
    : partialPreviewDetails?.preview
      ? partialPreviewDetails
      : progressPreviewDetails;
  const meta: DraftMetaItem[] = [];
  if (stats.operations > 0)
    meta.push({ text: plural(stats.operations, "operation") });
  const additions = stats.estimatedAdditions ?? stats.generatedLines;
  if (additions > 0) {
    meta.push({ text: `+${additions}`, tone: "success" });
  }
  if (stats.estimatedDeletions !== undefined && stats.estimatedDeletions > 0) {
    meta.push({ text: `-${stats.estimatedDeletions}`, tone: "error" });
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
    preview: previewDetails.preview,
    previewLanguage: previewDetails.previewLanguage,
    done: Boolean(draft.done),
  };
}

function summarizeBashDraft(draft: LiveToolCallDraft): ToolDraftSummary {
  const args = asRecord(draft.args);
  const finalCommand = stringField(args.command);
  const partialCommand = extractJsonStringEntries(draft.argsText, [
    "command",
  ] as const)[0]?.value;
  const command = finalCommand ?? partialCommand;
  const input = inlineInputPreview(command);
  const commandLineCount = lineCount(command);
  const hasCommand = command !== undefined && command.length > 0;
  const meta: DraftMetaItem[] = [];
  if (commandLineCount !== undefined && commandLineCount > 1) {
    meta.push({ text: plural(commandLineCount, "command line"), tone: "info" });
  }
  if (draft.done) meta.push({ text: "submitted", tone: "success" });
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
  draft: LiveToolCallDraft,
  cwd?: string,
): ToolDraftSummary {
  const args = asRecord(draft.args);
  const path = firstPathFromDraft(draft, cwd);
  const finalCode = stringField(args.code);
  const partialCode = extractJsonStringEntries(draft.argsText, [
    "code",
  ] as const)[0]?.value;
  const code = finalCode ?? partialCode;
  const input = inlineInputPreview(code);
  const codeLineCount = lineCount(code);
  const hasCode = code !== undefined && code.length > 0;
  const hasPath = path !== undefined && path.length > 0;
  const inputMode = hasPath && !hasCode ? "file" : "inline";
  const meta: DraftMetaItem[] = [];
  if (codeLineCount !== undefined && codeLineCount > 0) {
    meta.push({ text: plural(codeLineCount, "code line"), tone: "info" });
  }
  if (hasPath && !hasCode) meta.push({ text: "file", tone: "info" });
  if (draft.done) meta.push({ text: "submitted", tone: "success" });
  return {
    kind: "python",
    toolName: "python",
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

function firstKnownString(
  draft: LiveToolCallDraft,
  property: string,
): string | undefined {
  return (
    stringField(asRecord(draft.args)[property]) ??
    extractJsonStringValues(draft.argsText, property, { maxChars: 240 })[0]
  );
}

function genericPrimaryArg(draft: LiveToolCallDraft): string | undefined {
  const toolName = draft.toolName;
  if (toolName === "bash") return firstKnownString(draft, "command");
  if (toolName === "web_fetch") return firstKnownString(draft, "url");
  if (toolName === "web_search") return firstKnownString(draft, "query");
  const jiraArg = jiraDraftPrimaryArg(draft, firstKnownString);
  if (jiraArg !== undefined) return jiraArg;
  const confluenceArg = confluenceDraftPrimaryArg(draft, firstKnownString);
  if (confluenceArg !== undefined) return confluenceArg;
  if (toolName === "grep" || toolName === "find") {
    return firstKnownString(draft, "pattern");
  }
  if (toolName?.startsWith("task_")) {
    return (
      firstKnownString(draft, "taskId") ??
      firstKnownString(draft, "groupId") ??
      firstKnownString(draft, "name")
    );
  }
  return firstKnownString(draft, "path");
}

function genericMeta(draft: LiveToolCallDraft): DraftMetaItem[] {
  const meta: DraftMetaItem[] = [];
  if (draft.toolName?.startsWith("jira_")) {
    meta.push(...jiraDraftMeta(draft, firstKnownString));
  }
  if (draft.toolName?.startsWith("confluence_")) {
    meta.push(...confluenceDraftMeta(draft, firstKnownString));
  }
  const cwd = firstKnownString(draft, "cwd");
  if (cwd) meta.push({ text: "cwd", tone: "info" });
  if (draft.done) meta.push({ text: "submitted", tone: "success" });
  return meta;
}

function withDraftArgsPreview(
  summary: ToolDraftSummary,
  draft: LiveToolCallDraft,
): ToolDraftSummary {
  return {
    ...summary,
    ...draftArgsPreview(draft, {
      maxLines: DRAFT_PREVIEW_LINES,
      maxChars: DRAFT_PREVIEW_MAX_VALUE_CHARS,
    }),
  };
}

export function summarizeToolDraft(
  draft: LiveToolCallDraft,
  cwd?: string,
): ToolDraftSummary {
  if (draft.toolName === "write") {
    return withDraftArgsPreview(summarizeWriteDraft(draft, cwd), draft);
  }
  if (draft.toolName === "edit") {
    return withDraftArgsPreview(summarizeEditDraft(draft, cwd), draft);
  }
  if (draft.toolName === "bash") {
    return withDraftArgsPreview(summarizeBashDraft(draft), draft);
  }
  if (draft.toolName === "python") {
    return withDraftArgsPreview(summarizePythonDraft(draft, cwd), draft);
  }
  const toolName = draft.toolName ?? "tool";
  return withDraftArgsPreview(
    {
      kind: "generic",
      toolName,
      path: genericPrimaryArg(draft),
      statusText: draft.done
        ? `${toolName} arguments prepared.`
        : `Preparing ${toolName} arguments…`,
      meta: genericMeta(draft),
      done: Boolean(draft.done),
    },
    draft,
  );
}
