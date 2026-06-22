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

type NormalizedEditOperation =
  | {
      type: "replace_text";
      oldText: string;
      newText: string;
      matchMode: MatchMode;
      occurrence?: number;
    }
  | {
      type: "insert_text";
      anchor: string;
      position: "before" | "after";
      text: string;
      matchMode: MatchMode;
      occurrence?: number;
    }
  | {
      type: "replace_lines";
      startLine: number;
      endLine: number;
      newText: string;
    }
  | {
      type: "insert_lines";
      line: number;
      position: "before" | "after";
      text: string;
    }
  | { type: "apply_patch"; patch: string };

type NormalizedEditArgs = {
  dryRun: boolean;
  operations: NormalizedEditOperation[];
};

type ResolvedEditOperation = {
  index: number;
  type: EditOperationType;
  start: number;
  end: number;
  newText: string;
  details: EditOperationDetail;
};

type EditOperationDetail = {
  index: number;
  type: EditOperationType;
  matchMode?: MatchMode;
  occurrence?: number;
  matchCount?: number;
  startLine?: number;
  endLine?: number;
  matchedBy: "unique" | "occurrence" | "line_range" | "line_insert" | "patch";
};

const operationTypes = new Set<EditOperationType>([
  "replace_text",
  "insert_text",
  "replace_lines",
  "insert_lines",
  "apply_patch",
]);

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
          matchedBy: "patch",
        },
      ],
    };
  }

  if (operations.some((operation) => operation.type === "apply_patch")) {
    throw editError(
      "EDIT_ARGUMENT_INVALID",
      "operations[].type apply_patch must be the only edit operation.",
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
        path,
      });
      return {
        index,
        type: operation.type,
        start: match.selected.start,
        end: match.selected.end,
        newText: normalizeLineEndings(operation.newText),
        details: {
          index,
          type: operation.type,
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
        path,
      });
      const offset =
        operation.position === "before"
          ? match.selected.start
          : match.selected.end;
      return {
        index,
        type: operation.type,
        start: offset,
        end: offset,
        newText: normalizeLineEndings(operation.text),
        details: {
          index,
          type: operation.type,
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
        path,
      });
      return {
        index,
        type: operation.type,
        start: range.start,
        end: range.end,
        newText: normalizeLineEndings(operation.newText),
        details: {
          index,
          type: operation.type,
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
          path,
        },
      );
      return {
        index,
        type: operation.type,
        start: offset,
        end: offset,
        newText: normalizeLineEndings(operation.text),
        details: {
          index,
          type: operation.type,
          startLine: operation.line,
          endLine: operation.line,
          matchedBy: "line_insert",
        },
      };
    }
    case "apply_patch":
      throw argumentError("apply_patch must be the only edit operation.", {
        operationIndex: index,
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
        `operations[${current.index}] inserts at the same offset as operations[${previous.index}] in ${path}; merge same-location inserts into one operation.`,
        {
          path,
          previousIndex: previous.index,
          currentIndex: current.index,
          offset: current.start,
        },
        true,
      );
    }
    if (current.start < previous.end) {
      throw editError(
        "EDIT_OVERLAP",
        `operations[${current.index}] overlaps operations[${previous.index}] in ${path}; merge overlapping changes into one operation.`,
        {
          path,
          previousIndex: previous.index,
          currentIndex: current.index,
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
  context: { operationIndex: number; path: string },
): { start: number; end: number } {
  const lines = contentLineRanges(content);
  if (startLine > endLine) {
    throw argumentError(
      `operations[${context.operationIndex}].endLine must be greater than or equal to startLine.`,
      { operationIndex: context.operationIndex, startLine, endLine },
    );
  }
  const start = lines[startLine - 1];
  const end = lines[endLine - 1];
  if (!start || !end) {
    throw argumentError(
      `operations[${context.operationIndex}] replace_lines range ${startLine}-${endLine} is outside ${context.path}, which has ${lines.length} line(s).`,
      {
        operationIndex: context.operationIndex,
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
  context: { operationIndex: number; path: string },
): number {
  const lines = contentLineRanges(content);
  const target = lines[line - 1];
  if (!target) {
    throw argumentError(
      `operations[${context.operationIndex}] insert_lines line ${line} is outside ${context.path}, which has ${lines.length} line(s).`,
      {
        operationIndex: context.operationIndex,
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
  let operationsValue = parseOperationsValue(args.operations);
  if (!Array.isArray(operationsValue)) {
    if (typeof args.oldText === "string" && typeof args.newText === "string") {
      operationsValue = [
        { type: "replace_text", oldText: args.oldText, newText: args.newText },
      ];
    } else if (typeof args.patch === "string") {
      operationsValue = [{ type: "apply_patch", patch: args.patch }];
    }
  }
  if (!Array.isArray(operationsValue) || operationsValue.length === 0) {
    throw argumentError(
      "Tool argument 'operations' must contain at least one operation.",
    );
  }
  return {
    dryRun,
    operations: operationsValue.map((entry, index) =>
      normalizeOperation(entry, index),
    ),
  };
}

function parseOperationsValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeOperation(
  entry: unknown,
  index: number,
): NormalizedEditOperation {
  if (!entry || typeof entry !== "object") {
    throw argumentError(`operations[${index}] must be an object.`, {
      operationIndex: index,
    });
  }
  const record = entry as Record<string, unknown>;
  const type = stringArg(record.type, `operations[${index}].type`);
  if (!operationTypes.has(type as EditOperationType)) {
    throw argumentError(
      `operations[${index}].type must be one of ${[...operationTypes].join(", ")}.`,
      { operationIndex: index, type },
    );
  }

  switch (type as EditOperationType) {
    case "replace_text":
      assertAllowedFields(record, index, [
        "type",
        "oldText",
        "newText",
        "matchMode",
        "occurrence",
      ]);
      return withOptionalOccurrence(
        {
          type: "replace_text",
          oldText: nonEmptyStringArg(
            record.oldText,
            `operations[${index}].oldText`,
          ),
          newText: stringArg(record.newText, `operations[${index}].newText`),
          matchMode: matchModeArg(record.matchMode, index),
        },
        optionalPositiveIntegerArg(
          record.occurrence,
          `operations[${index}].occurrence`,
        ),
      );
    case "insert_text":
      assertAllowedFields(record, index, [
        "type",
        "anchor",
        "position",
        "text",
        "matchMode",
        "occurrence",
      ]);
      return withOptionalOccurrence(
        {
          type: "insert_text",
          anchor: nonEmptyStringArg(
            record.anchor,
            `operations[${index}].anchor`,
          ),
          position: positionArg(
            record.position,
            `operations[${index}].position`,
          ),
          text: stringArg(record.text, `operations[${index}].text`),
          matchMode: matchModeArg(record.matchMode, index),
        },
        optionalPositiveIntegerArg(
          record.occurrence,
          `operations[${index}].occurrence`,
        ),
      );
    case "replace_lines":
      assertAllowedFields(record, index, [
        "type",
        "startLine",
        "endLine",
        "newText",
      ]);
      return {
        type: "replace_lines",
        startLine: positiveIntegerArg(
          record.startLine,
          `operations[${index}].startLine`,
        ),
        endLine: positiveIntegerArg(
          record.endLine,
          `operations[${index}].endLine`,
        ),
        newText: stringArg(record.newText, `operations[${index}].newText`),
      };
    case "insert_lines":
      assertAllowedFields(record, index, ["type", "line", "position", "text"]);
      return {
        type: "insert_lines",
        line: positiveIntegerArg(record.line, `operations[${index}].line`),
        position: positionArg(record.position, `operations[${index}].position`),
        text: stringArg(record.text, `operations[${index}].text`),
      };
    case "apply_patch":
      assertAllowedFields(record, index, ["type", "patch"]);
      return {
        type: "apply_patch",
        patch: nonEmptyStringArg(record.patch, `operations[${index}].patch`),
      };
  }
}

function withOptionalOccurrence<
  T extends
    | Omit<
        Extract<NormalizedEditOperation, { type: "replace_text" }>,
        "occurrence"
      >
    | Omit<
        Extract<NormalizedEditOperation, { type: "insert_text" }>,
        "occurrence"
      >,
>(operation: T, occurrence: number | undefined): T & { occurrence?: number } {
  if (occurrence === undefined) return operation;
  return { ...operation, occurrence };
}

function assertAllowedFields(
  record: Record<string, unknown>,
  index: number,
  allowed: string[],
): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(record).filter((key) => !allowedSet.has(key));
  if (unexpected.length === 0) return;
  throw argumentError(
    `operations[${index}] has unsupported field(s) for ${String(record.type)}: ${unexpected.join(", ")}.`,
    { operationIndex: index, type: record.type, unexpected },
  );
}

function booleanArg(value: unknown, fallback: boolean, name: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw argumentError(`Tool argument '${name}' must be a boolean.`);
  }
  return value;
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

function matchModeArg(value: unknown, index: number): MatchMode {
  if (value === undefined) return "exact";
  if (typeof value !== "string" || !matchModes.has(value as MatchMode)) {
    throw argumentError(
      `operations[${index}].matchMode must be one of exact, trimmed, whitespace.`,
      { operationIndex: index, matchMode: value },
    );
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
