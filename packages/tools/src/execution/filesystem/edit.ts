import { readFile } from "node:fs/promises";
import { applyPatch, parsePatch } from "diff";
import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { ToolExecutionError } from "../common/tool-error.js";
import { writeTextFileAtomically } from "./atomic-write.js";
import { withFileMutationQueue } from "./file-mutation-queue.js";
import { resolveToolPath } from "./path.js";
import { type MatchMode, resolveTextMatch } from "./smart-match.js";
import {
  detectLineEnding,
  firstChangedLine,
  generateDiffString,
  normalizeLineEndings,
  restoreLineEndings,
} from "./text-editing.js";

type EditOperationType =
  | "replace_text"
  | "insert_text"
  | "replace_lines"
  | "insert_lines"
  | "apply_patch";

type EditOperationSourceKey =
  | "replacements"
  | "insertions"
  | "lineReplacements"
  | "lineInsertions"
  | "patch";

type EditOperationSource = {
  key: EditOperationSourceKey;
  index: number;
  label: string;
};

type NormalizedEditOperation =
  | {
      type: "replace_text";
      oldText: string;
      newText: string;
      matchMode: MatchMode;
      occurrence?: number;
      source: EditOperationSource;
    }
  | {
      type: "insert_text";
      anchor: string;
      position: "before" | "after";
      text: string;
      matchMode: MatchMode;
      occurrence?: number;
      source: EditOperationSource;
    }
  | {
      type: "replace_lines";
      startLine: number;
      endLine: number;
      newText: string;
      source: EditOperationSource;
    }
  | {
      type: "insert_lines";
      line: number;
      position: "before" | "after";
      text: string;
      source: EditOperationSource;
    }
  | { type: "apply_patch"; patch: string; source: EditOperationSource };

type NormalizedEditArgs = {
  dryRun: boolean;
  operations: NormalizedEditOperation[];
};

type ResolvedEditOperation = {
  index: number;
  type: EditOperationType;
  source: EditOperationSource;
  start: number;
  end: number;
  newText: string;
  details: EditOperationDetail;
};
type EditOperationDetail = {
  index: number;
  type: EditOperationType;
  source: EditOperationSourceKey;
  sourceIndex: number;
  matchMode?: MatchMode;
  occurrence?: number;
  matchCount?: number;
  startLine?: number;
  endLine?: number;
  matchedBy: "unique" | "occurrence" | "line_range" | "line_insert" | "patch";
};
const matchModes = new Set<MatchMode>(["exact", "trimmed", "whitespace"]);
const positions = new Set(["before", "after"]);

export async function executeEdit(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const path = resolveToolPath(context.cwd, args.path);
  const normalized = normalizeEditArgs(args);

  return withFileMutationQueue(path, async () => {
    const raw = await readFile(path, "utf8");
    if (raw.includes("\0")) {
      throw editError(
        "EDIT_BINARY_FILE",
        `edit cannot edit ${path} because it appears to be a binary file.`,
        { path },
      );
    }

    const bom = raw.startsWith("\uFEFF") ? "\uFEFF" : "";
    const withoutBom = bom ? raw.slice(1) : raw;
    const lineEnding = detectLineEnding(withoutBom);
    const content = normalizeLineEndings(withoutBom);

    const { updated, operationDetails } = resolveEditOperations(
      content,
      normalized.operations,
      path,
    );

    if (updated === content) {
      throw editError("EDIT_NO_CHANGE", `edit would not change ${path}.`, {
        path,
        operationCount: normalized.operations.length,
      });
    }

    if (!normalized.dryRun) {
      const restored = bom + restoreLineEndings(updated, lineEnding);
      await writeTextFileAtomically(path, restored);
    }

    const contentMessage = normalized.dryRun
      ? `Previewed edit with ${normalized.operations.length} operation(s); no file was written.`
      : `Edited file with ${normalized.operations.length} operation(s).`;
    return {
      path,
      content: contentMessage,
      contentBlocks: [{ type: "text", text: contentMessage }],
      details: {
        diff: generateDiffString(content, updated),
        firstChangedLine: firstChangedLine(content, updated),
        lineEnding,
        bom: Boolean(bom),
        dryRun: normalized.dryRun,
        operationCount: normalized.operations.length,
        operations: operationDetails,
      },
    };
  });
}

function resolveEditOperations(
  content: string,
  operations: NormalizedEditOperation[],
  path: string,
): { updated: string; operationDetails: EditOperationDetail[] } {
  if (operations.length === 1 && operations[0]?.type === "apply_patch") {
    const updated = applySingleFilePatch(content, operations[0].patch, path);
    return {
      updated,
      operationDetails: [
        {
          index: 0,
          type: "apply_patch",
          source: operations[0].source.key,
          sourceIndex: operations[0].source.index,
          matchedBy: "patch",
        },
      ],
    };
  }

  if (operations.some((operation) => operation.type === "apply_patch")) {
    throw editError(
      "EDIT_ARGUMENT_INVALID",
      "patch must not be combined with replacements, insertions, lineReplacements, or lineInsertions.",
      { operationTypes: operations.map((operation) => operation.type) },
      true,
    );
  }

  const resolved = operations.map((operation, index) =>
    resolveOperation(content, operation, index, path),
  );
  const ordered = [...resolved].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  );
  rejectOverlappingOperations(ordered, path);

  let updated = content;
  for (const operation of [...ordered].reverse()) {
    updated = `${updated.slice(0, operation.start)}${operation.newText}${updated.slice(operation.end)}`;
  }

  return {
    updated,
    operationDetails: resolved.map((operation) => operation.details),
  };
}

function resolveOperation(
  content: string,
  operation: NormalizedEditOperation,
  index: number,
  path: string,
): ResolvedEditOperation {
  switch (operation.type) {
    case "replace_text": {
      const match = resolveTextMatch({
        content,
        needle: operation.oldText,
        matchMode: operation.matchMode,
        occurrence: operation.occurrence,
        operationIndex: index,
        operationType: operation.type,
        fieldName: "oldText",
        fieldLabel: `${operation.source.label}.oldText`,
        path,
      });
      return {
        index,
        type: operation.type,
        source: operation.source,
        start: match.selected.start,
        end: match.selected.end,
        newText: normalizeLineEndings(operation.newText),
        details: {
          index,
          type: operation.type,
          source: operation.source.key,
          sourceIndex: operation.source.index,
          matchMode: operation.matchMode,
          occurrence: operation.occurrence,
          matchCount: match.matches.length,
          startLine: match.selected.startLine,
          endLine: match.selected.endLine,
          matchedBy: match.matchedBy,
        },
      };
    }
    case "insert_text": {
      const match = resolveTextMatch({
        content,
        needle: operation.anchor,
        matchMode: operation.matchMode,
        occurrence: operation.occurrence,
        operationIndex: index,
        operationType: operation.type,
        fieldName: "anchor",
        fieldLabel: `${operation.source.label}.anchor`,
        path,
      });
      const offset =
        operation.position === "before"
          ? match.selected.start
          : match.selected.end;
      return {
        index,
        type: operation.type,
        source: operation.source,
        start: offset,
        end: offset,
        newText: normalizeLineEndings(operation.text),
        details: {
          index,
          type: operation.type,
          source: operation.source.key,
          sourceIndex: operation.source.index,
          matchMode: operation.matchMode,
          occurrence: operation.occurrence,
          matchCount: match.matches.length,
          startLine: match.selected.startLine,
          endLine: match.selected.endLine,
          matchedBy: match.matchedBy,
        },
      };
    }
    case "replace_lines": {
      const range = lineRange(content, operation.startLine, operation.endLine, {
        operationIndex: index,
        sourceLabel: operation.source.label,
        path,
      });
      return {
        index,
        type: operation.type,
        source: operation.source,
        start: range.start,
        end: range.end,
        newText: normalizeLineEndings(operation.newText),
        details: {
          index,
          type: operation.type,
          source: operation.source.key,
          sourceIndex: operation.source.index,
          startLine: operation.startLine,
          endLine: operation.endLine,
          matchedBy: "line_range",
        },
      };
    }
    case "insert_lines": {
      const offset = lineInsertOffset(
        content,
        operation.line,
        operation.position,
        {
          operationIndex: index,
          sourceLabel: operation.source.label,
          path,
        },
      );
      return {
        index,
        type: operation.type,
        source: operation.source,
        start: offset,
        end: offset,
        newText: normalizeLineEndings(operation.text),
        details: {
          index,
          type: operation.type,
          source: operation.source.key,
          sourceIndex: operation.source.index,
          startLine: operation.line,
          endLine: operation.line,
          matchedBy: "line_insert",
        },
      };
    }
    case "apply_patch":
      throw argumentError("patch must be the only edit operation.", {
        operationIndex: index,
        source: operation.source.key,
        sourceIndex: operation.source.index,
        path,
      });
  }
}

function applySingleFilePatch(
  content: string,
  patch: string,
  path: string,
): string {
  const normalizedPatch = normalizeLineEndings(patch);
  let parsed: ReturnType<typeof parsePatch>;
  try {
    parsed = parsePatch(normalizedPatch);
  } catch (error) {
    throw editError(
      "EDIT_PATCH_INVALID",
      `edit apply_patch could not parse patch for ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { path },
      true,
    );
  }
  if (parsed.length !== 1) {
    throw editError(
      "EDIT_PATCH_INVALID",
      `edit apply_patch for ${path} must contain exactly one file patch; found ${parsed.length}.`,
      { path, patchCount: parsed.length },
      true,
    );
  }
  const patchIndex = parsed[0];
  if (!patchIndex || patchIndex.hunks.length === 0) {
    throw editError(
      "EDIT_PATCH_INVALID",
      `edit apply_patch for ${path} must contain at least one hunk.`,
      { path },
      true,
    );
  }
  if (
    patchIndex.oldFileName === "/dev/null" ||
    patchIndex.newFileName === "/dev/null"
  ) {
    throw editError(
      "EDIT_PATCH_INVALID",
      `edit apply_patch for ${path} cannot create or delete files. Use write or an explicit destructive workflow instead.`,
      {
        path,
        oldFileName: patchIndex.oldFileName,
        newFileName: patchIndex.newFileName,
      },
      true,
    );
  }

  const patched = applyPatch(content, patchIndex, {
    fuzzFactor: 0,
    autoConvertLineEndings: false,
  });
  if (patched === false) {
    throw editError(
      "EDIT_PATCH_APPLY_FAILED",
      `edit apply_patch could not apply cleanly to ${path}. Refresh the file and regenerate the patch with current context.`,
      { path },
      true,
    );
  }
  return patched;
}

function rejectOverlappingOperations(
  ordered: ResolvedEditOperation[],
  path: string,
): void {
  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1];
    const current = ordered[i];
    if (!previous || !current) continue;
    if (
      previous.start === previous.end &&
      current.start === current.end &&
      previous.start === current.start
    ) {
      throw editError(
        "EDIT_OVERLAP",
        `${current.source.label} inserts at the same offset as ${previous.source.label} in ${path}; merge same-location inserts into one operation.`,
        {
          path,
          previousIndex: previous.index,
          currentIndex: current.index,
          previousSource: previous.source,
          currentSource: current.source,
          offset: current.start,
        },
        true,
      );
    }
    if (current.start < previous.end) {
      throw editError(
        "EDIT_OVERLAP",
        `${current.source.label} overlaps ${previous.source.label} in ${path}; merge overlapping changes into one operation.`,
        {
          path,
          previousIndex: previous.index,
          currentIndex: current.index,
          previousSource: previous.source,
          currentSource: current.source,
          previousRange: { start: previous.start, end: previous.end },
          currentRange: { start: current.start, end: current.end },
        },
        true,
      );
    }
  }
}

function lineRange(
  content: string,
  startLine: number,
  endLine: number,
  context: { operationIndex: number; sourceLabel: string; path: string },
): { start: number; end: number } {
  const lines = contentLineRanges(content);
  if (startLine > endLine) {
    throw argumentError(
      `${context.sourceLabel}.endLine must be greater than or equal to startLine.`,
      {
        operationIndex: context.operationIndex,
        sourceLabel: context.sourceLabel,
        startLine,
        endLine,
      },
    );
  }
  const start = lines[startLine - 1];
  const end = lines[endLine - 1];
  if (!start || !end) {
    throw argumentError(
      `${context.sourceLabel} range ${startLine}-${endLine} is outside ${context.path}, which has ${lines.length} line(s).`,
      {
        operationIndex: context.operationIndex,
        sourceLabel: context.sourceLabel,
        path: context.path,
        startLine,
        endLine,
        lineCount: lines.length,
      },
    );
  }
  return { start: start.start, end: end.endWithNewline };
}

function lineInsertOffset(
  content: string,
  line: number,
  position: "before" | "after",
  context: { operationIndex: number; sourceLabel: string; path: string },
): number {
  const lines = contentLineRanges(content);
  const target = lines[line - 1];
  if (!target) {
    throw argumentError(
      `${context.sourceLabel} line ${line} is outside ${context.path}, which has ${lines.length} line(s).`,
      {
        operationIndex: context.operationIndex,
        sourceLabel: context.sourceLabel,
        path: context.path,
        line,
        lineCount: lines.length,
      },
    );
  }
  return position === "before" ? target.start : target.endWithNewline;
}

function contentLineRanges(
  content: string,
): Array<{ start: number; end: number; endWithNewline: number }> {
  if (content.length === 0) return [];
  const ranges: Array<{ start: number; end: number; endWithNewline: number }> =
    [];
  let start = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== "\n") continue;
    ranges.push({ start, end: index, endWithNewline: index + 1 });
    start = index + 1;
  }
  if (start < content.length) {
    ranges.push({ start, end: content.length, endWithNewline: content.length });
  }
  return ranges;
}

export function normalizeEditArgs(
  args: Record<string, unknown>,
): NormalizedEditArgs {
  const dryRun = booleanArg(args.dryRun, false, "dryRun");
  rejectDeprecatedEditArgs(args);

  const operations: NormalizedEditOperation[] = [];
  const replacements = arrayArg(args.replacements, "replacements");
  const insertions = arrayArg(args.insertions, "insertions");
  const lineReplacements = arrayArg(args.lineReplacements, "lineReplacements");
  const lineInsertions = arrayArg(args.lineInsertions, "lineInsertions");
  const patch = optionalStringArg(args.patch, "patch");
  const hasArrayEdits = Boolean(
    replacements || insertions || lineReplacements || lineInsertions,
  );

  if (patch !== undefined && hasArrayEdits) {
    throw argumentError(
      "Tool argument 'patch' must not be combined with replacements, insertions, lineReplacements, or lineInsertions.",
      { hasPatch: true },
    );
  }

  if (replacements) {
    operations.push(...replacements.map(normalizeReplacement));
  }
  if (insertions) {
    operations.push(...insertions.map(normalizeInsertion));
  }
  if (lineReplacements) {
    operations.push(...lineReplacements.map(normalizeLineReplacement));
  }
  if (lineInsertions) {
    operations.push(...lineInsertions.map(normalizeLineInsertion));
  }
  if (patch !== undefined) {
    operations.push({
      type: "apply_patch",
      patch: nonEmptyStringArg(patch, "patch"),
      source: sourceFor("patch", 0),
    });
  }

  if (operations.length === 0) {
    throw argumentError(
      "Provide at least one edit using replacements, insertions, lineReplacements, lineInsertions, or patch.",
    );
  }

  return { dryRun, operations };
}

function rejectDeprecatedEditArgs(args: Record<string, unknown>): void {
  if (args.operations !== undefined) {
    throw argumentError(
      "Tool argument 'operations' is no longer supported; use replacements, insertions, lineReplacements, lineInsertions, or patch.",
    );
  }
  if (args.oldText !== undefined || args.newText !== undefined) {
    throw argumentError(
      "Top-level oldText/newText are no longer supported for edit; use replacements: [{ oldText, newText }].",
    );
  }
}

function arrayArg(
  value: unknown,
  name: EditOperationSourceKey,
): unknown[] | undefined {
  if (value === undefined) return undefined;
  const parsed = parseArrayValue(value);
  if (!Array.isArray(parsed)) {
    throw argumentError(`Tool argument '${name}' must be an array.`, {
      source: name,
    });
  }
  if (parsed.length === 0) {
    throw argumentError(
      `Tool argument '${name}' must contain at least one item.`,
      {
        source: name,
      },
    );
  }
  return parsed;
}

function parseArrayValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeReplacement(
  entry: unknown,
  index: number,
): NormalizedEditOperation {
  const label = `replacements[${index}]`;
  const record = objectArg(entry, label);
  assertAllowedFields(record, label, [
    "oldText",
    "newText",
    "matchMode",
    "occurrence",
  ]);
  const operation = {
    type: "replace_text" as const,
    oldText: nonEmptyStringArg(record.oldText, `${label}.oldText`),
    newText: stringArg(record.newText, `${label}.newText`),
    matchMode: matchModeArg(record.matchMode, `${label}.matchMode`),
    source: sourceFor("replacements", index),
  };
  const occurrence = optionalPositiveIntegerArg(
    record.occurrence,
    `${label}.occurrence`,
  );
  return occurrence === undefined ? operation : { ...operation, occurrence };
}

function normalizeInsertion(
  entry: unknown,
  index: number,
): NormalizedEditOperation {
  const label = `insertions[${index}]`;
  const record = objectArg(entry, label);
  assertAllowedFields(record, label, [
    "anchor",
    "position",
    "text",
    "matchMode",
    "occurrence",
  ]);
  const operation = {
    type: "insert_text" as const,
    anchor: nonEmptyStringArg(record.anchor, `${label}.anchor`),
    position: positionArg(record.position, `${label}.position`),
    text: stringArg(record.text, `${label}.text`),
    matchMode: matchModeArg(record.matchMode, `${label}.matchMode`),
    source: sourceFor("insertions", index),
  };
  const occurrence = optionalPositiveIntegerArg(
    record.occurrence,
    `${label}.occurrence`,
  );
  return occurrence === undefined ? operation : { ...operation, occurrence };
}

function normalizeLineReplacement(
  entry: unknown,
  index: number,
): NormalizedEditOperation {
  const label = `lineReplacements[${index}]`;
  const record = objectArg(entry, label);
  assertAllowedFields(record, label, ["startLine", "endLine", "newText"]);
  return {
    type: "replace_lines",
    startLine: positiveIntegerArg(record.startLine, `${label}.startLine`),
    endLine: positiveIntegerArg(record.endLine, `${label}.endLine`),
    newText: stringArg(record.newText, `${label}.newText`),
    source: sourceFor("lineReplacements", index),
  };
}

function normalizeLineInsertion(
  entry: unknown,
  index: number,
): NormalizedEditOperation {
  const label = `lineInsertions[${index}]`;
  const record = objectArg(entry, label);
  assertAllowedFields(record, label, ["line", "position", "text"]);
  return {
    type: "insert_lines",
    line: positiveIntegerArg(record.line, `${label}.line`),
    position: positionArg(record.position, `${label}.position`),
    text: stringArg(record.text, `${label}.text`),
    source: sourceFor("lineInsertions", index),
  };
}

function objectArg(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw argumentError(`${label} must be an object.`, { sourceLabel: label });
  }
  return value as Record<string, unknown>;
}

function sourceFor(
  key: EditOperationSourceKey,
  index: number,
): EditOperationSource {
  return {
    key,
    index,
    label: key === "patch" ? "patch" : `${key}[${index}]`,
  };
}

function assertAllowedFields(
  record: Record<string, unknown>,
  label: string,
  allowed: string[],
): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(record).filter((key) => !allowedSet.has(key));
  if (unexpected.length === 0) return;
  throw argumentError(
    `${label} has unsupported field(s): ${unexpected.join(", ")}.`,
    { sourceLabel: label, unexpected },
  );
}

function booleanArg(value: unknown, fallback: boolean, name: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw argumentError(`Tool argument '${name}' must be a boolean.`);
  }
  return value;
}

function optionalStringArg(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return stringArg(value, name);
}

function stringArg(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw argumentError(`${name} must be a string.`);
  }
  return value;
}

function nonEmptyStringArg(value: unknown, name: string): string {
  const text = stringArg(value, name);
  if (text.length === 0) {
    throw argumentError(`${name} must be a non-empty string.`);
  }
  return text;
}

function positiveIntegerArg(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw argumentError(`${name} must be a positive integer.`);
  }
  return value;
}

function optionalPositiveIntegerArg(
  value: unknown,
  name: string,
): number | undefined {
  if (value === undefined) return undefined;
  return positiveIntegerArg(value, name);
}

function positionArg(value: unknown, name: string): "before" | "after" {
  if (typeof value !== "string" || !positions.has(value)) {
    throw argumentError(`${name} must be either "before" or "after".`);
  }
  return value as "before" | "after";
}

function matchModeArg(value: unknown, name: string): MatchMode {
  if (value === undefined) return "exact";
  if (typeof value !== "string" || !matchModes.has(value as MatchMode)) {
    throw argumentError(`${name} must be one of exact, trimmed, whitespace.`, {
      matchMode: value,
    });
  }
  return value as MatchMode;
}

function argumentError(
  message: string,
  details: Record<string, unknown> = {},
): ToolExecutionError {
  return editError("EDIT_ARGUMENT_INVALID", message, details, true);
}

function editError(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
  retryable = false,
): ToolExecutionError {
  return new ToolExecutionError(code, message, details, retryable);
}
