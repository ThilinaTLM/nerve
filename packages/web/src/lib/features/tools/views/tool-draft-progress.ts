import type { LiveToolCallDraft } from "$lib/core/types/state-types";

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

function firstPathFromDraft(draft: LiveToolCallDraft): string | undefined {
  const args = asRecord(draft.args);
  return (
    stringField(args.path) ??
    draft.progress?.path ??
    extractJsonStringValues(draft.argsText, "path", { maxChars: 240 })[0]
  );
}

function summarizeWriteDraft(draft: LiveToolCallDraft): ToolDraftSummary {
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
    path: firstPathFromDraft(draft),
    statusText: draft.done ? "Submitting" : "Generating",
    meta,
    lineCount: lines,
    generatedLineCount: lines,
    estimated,
    done: Boolean(draft.done),
  };
}

type EditDraftStats = {
  replacements: number;
  generatedLines: number;
  estimatedAdditions?: number;
  estimatedDeletions?: number;
  estimated: boolean;
};

function finalEditStats(
  args: Record<string, unknown>,
): EditDraftStats | undefined {
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

function progressEditStats(
  draft: LiveToolCallDraft,
): EditDraftStats | undefined {
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

function partialEditStats(argsText: string): EditDraftStats {
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

type SmartEditDraftStats = {
  operations: number;
  generatedLines: number;
  estimatedAdditions?: number;
  estimatedDeletions?: number;
  estimated: boolean;
};

function isSmartEditOperationType(value: string): boolean {
  return (
    value === "replace_text" ||
    value === "insert_text" ||
    value === "replace_lines" ||
    value === "insert_lines" ||
    value === "apply_patch"
  );
}

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

function smartEditStatsForOperations(
  operations: unknown[],
  estimated: boolean,
): SmartEditDraftStats {
  let additions = 0;
  let deletions = 0;
  for (const operation of operations) {
    const record = asRecord(operation);
    additions += lineCount(stringField(record.newText)) ?? 0;
    additions += lineCount(stringField(record.text)) ?? 0;
    deletions += lineCount(stringField(record.oldText)) ?? 0;
    const patch = stringField(record.patch);
    if (patch) {
      const patchStats = patchLineStats(patch);
      additions += patchStats.additions;
      deletions += patchStats.deletions;
    }
  }
  return {
    operations: operations.length,
    generatedLines: additions,
    estimatedAdditions: additions,
    estimatedDeletions: deletions,
    estimated,
  };
}

function finalSmartEditStats(
  args: Record<string, unknown>,
): SmartEditDraftStats | undefined {
  if (!Array.isArray(args.operations)) return undefined;
  return smartEditStatsForOperations(args.operations, false);
}

function progressSmartEditStats(
  draft: LiveToolCallDraft,
): SmartEditDraftStats | undefined {
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

function partialSmartEditStats(argsText: string): SmartEditDraftStats {
  const types = extractJsonStringValues(argsText, "type", {
    maxChars: 64,
  }).filter(isSmartEditOperationType);
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
    operations: types.length,
    generatedLines: additions,
    estimatedAdditions: additions,
    estimatedDeletions: deletions,
    estimated: true,
  };
}

function summarizeEditDraft(draft: LiveToolCallDraft): ToolDraftSummary {
  const args = asRecord(draft.args);
  const finalStats = finalEditStats(args);
  const partialStats = draft.argsText
    ? partialEditStats(draft.argsText)
    : undefined;
  const progressStats = progressEditStats(draft);
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
    toolName: "edit",
    path: firstPathFromDraft(draft),
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

function summarizeSmartEditDraft(draft: LiveToolCallDraft): ToolDraftSummary {
  const args = asRecord(draft.args);
  const finalStats = finalSmartEditStats(args);
  const partialStats = draft.argsText
    ? partialSmartEditStats(draft.argsText)
    : undefined;
  const progressStats = progressSmartEditStats(draft);
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
    toolName: "smart_edit",
    path: firstPathFromDraft(draft),
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

function summarizePythonDraft(draft: LiveToolCallDraft): ToolDraftSummary {
  const args = asRecord(draft.args);
  const path = firstPathFromDraft(draft);
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

export function summarizeToolDraft(draft: LiveToolCallDraft): ToolDraftSummary {
  if (draft.toolName === "write") return summarizeWriteDraft(draft);
  if (draft.toolName === "edit") return summarizeEditDraft(draft);
  if (draft.toolName === "smart_edit") return summarizeSmartEditDraft(draft);
  if (draft.toolName === "python") return summarizePythonDraft(draft);
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
