import type { LiveToolCallDraft } from "$lib/core/types/state-types";
import { relativePathForDisplay } from "$lib/core/utils/path-links";

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

export type ToolDraftSummary = {
  kind: "write" | "edit" | "python" | "generic";
  toolName: string;
  path?: string;
  statusText: string;
  meta: DraftMetaItem[];
  lineCount?: number;
  replacementCount?: number;
  operationCount?: number;
  generatedLineCount?: number;
  estimatedAdditions?: number;
  estimatedDeletions?: number;
  estimated?: boolean;
  code?: string;
  codeLineCount?: number;
  language?: "python";
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
    done: Boolean(draft.done),
  };
}

type LegacyEditDraftStats = {
  replacements: number;
  generatedLines: number;
  estimatedAdditions?: number;
  estimatedDeletions?: number;
  estimated: boolean;
};

function finalLegacyEditStats(
  args: Record<string, unknown>,
): LegacyEditDraftStats | undefined {
  if (!Array.isArray(args.edits)) return undefined;
  let generatedLines = 0;
  let deletedLines = 0;
  for (const edit of args.edits) {
    const record = asRecord(edit);
    generatedLines += lineCount(stringField(record.newText)) ?? 0;
    deletedLines += lineCount(stringField(record.oldText)) ?? 0;
  }
  return {
    replacements: args.edits.length,
    generatedLines,
    estimatedAdditions: generatedLines,
    estimatedDeletions: deletedLines,
    estimated: false,
  };
}

function progressLegacyEditStats(
  draft: LiveToolCallDraft,
): LegacyEditDraftStats | undefined {
  const progress = draft.progress;
  if (!progress) return undefined;
  return {
    replacements: progress.replacementCount ?? 0,
    generatedLines: progress.generatedLineCount ?? 0,
    estimatedAdditions: progress.estimatedAdditions,
    estimatedDeletions: progress.estimatedDeletions,
    estimated: progress.estimated,
  };
}

function partialLegacyEditStats(argsText: string): LegacyEditDraftStats {
  const oldTextLines = lineCountsForJsonStringValues(argsText, "oldText");
  const newTextLines = lineCountsForJsonStringValues(argsText, "newText");
  const replacements = Math.max(newTextLines.length, oldTextLines.length);
  return {
    replacements,
    generatedLines: newTextLines.reduce((total, count) => total + count, 0),
    estimatedAdditions: newTextLines.reduce((total, count) => total + count, 0),
    estimatedDeletions: oldTextLines.reduce((total, count) => total + count, 0),
    estimated: true,
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

function summarizeLegacyEditDraft(
  draft: LiveToolCallDraft,
  cwd?: string,
): ToolDraftSummary {
  const args = asRecord(draft.args);
  const finalStats = finalLegacyEditStats(args);
  const partialStats = draft.argsText
    ? partialLegacyEditStats(draft.argsText)
    : undefined;
  const progressStats = progressLegacyEditStats(draft);
  const stats = finalStats ??
    partialStats ??
    progressStats ?? {
      replacements: 0,
      generatedLines: 0,
      estimated: false,
    };
  const meta: DraftMetaItem[] = [];
  const additions = stats.estimatedAdditions ?? stats.generatedLines;
  if (additions > 0) {
    meta.push({ text: `+${additions}`, tone: "success" });
  }
  if (stats.estimatedDeletions !== undefined && stats.estimatedDeletions > 0) {
    meta.push({ text: `-${stats.estimatedDeletions}`, tone: "error" });
  }
  return {
    kind: "edit",
    toolName: "legacy_edit",
    path: firstPathFromDraft(draft, cwd),
    statusText: draft.done ? "Submitting" : "Generating",
    meta,
    replacementCount: stats.replacements,
    generatedLineCount: stats.generatedLines,
    estimatedAdditions: stats.estimatedAdditions,
    estimatedDeletions: stats.estimatedDeletions,
    estimated: stats.estimated,
    done: Boolean(draft.done),
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
  const partialCode = extractJsonStringValues(draft.argsText, "code", {
    maxChars: 24_000,
  })[0];
  const code = finalCode ?? partialCode;
  const codeLineCount = lineCount(code);
  const hasCode = code !== undefined && code.length > 0;
  const hasPath = path !== undefined && path.length > 0;
  const meta: DraftMetaItem[] = [];
  if (codeLineCount !== undefined && codeLineCount > 0) {
    meta.push({ text: plural(codeLineCount, "code line"), tone: "info" });
  }
  if (hasPath) meta.push({ text: "file", tone: "info" });
  if (draft.done) meta.push({ text: "submitted", tone: "success" });
  return {
    kind: "python",
    toolName: "python",
    path,
    statusText: hasPath
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
    language: "python",
    done: Boolean(draft.done),
  };
}

export function summarizeToolDraft(
  draft: LiveToolCallDraft,
  cwd?: string,
): ToolDraftSummary {
  if (draft.toolName === "write") return summarizeWriteDraft(draft, cwd);
  if (draft.toolName === "edit") return summarizeEditDraft(draft, cwd);
  if (draft.toolName === "legacy_edit") {
    return summarizeLegacyEditDraft(draft, cwd);
  }
  if (draft.toolName === "python") return summarizePythonDraft(draft, cwd);
  const toolName = draft.toolName ?? "tool";
  return {
    kind: "generic",
    toolName,
    statusText: draft.done
      ? `${toolName} arguments prepared.`
      : `Preparing ${toolName} arguments…`,
    meta: draft.done ? [{ text: "submitted", tone: "success" }] : [],
    done: Boolean(draft.done),
  };
}
