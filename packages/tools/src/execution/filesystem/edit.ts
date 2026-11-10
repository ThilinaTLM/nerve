import { readFile } from "node:fs/promises";
import type {
  FilesystemExecutionContext,
  ToolExecutionResult,
} from "../execution-context.js";
import { writeTextFileAtomically } from "./atomic-write.js";
import { ToolExecutionError } from "../errors/tool-error.js";
import { argumentError, editError } from "./edit-errors.js";
import { withFileMutationQueue } from "./file-mutation-queue.js";
import { isErrnoException, resolveToolPath } from "./path.js";
import {
  detectLineEnding,
  firstChangedLine,
  generateDiffString,
  normalizeLineEndings,
  restoreLineEndings,
} from "./text-editing.js";

type ExactEdit = {
  oldText: string;
  newText: string;
};

type ResolvedEdit = {
  index: number;
  start: number;
  end: number;
  newText: string;
  startLine: number;
  endLine: number;
};

export async function executeEdit(
  args: Record<string, unknown>,
  context: FilesystemExecutionContext,
): Promise<ToolExecutionResult> {
  const path = resolveToolPath(context.cwd, args.path);
  const shown = String(args.path).trim();
  try {
    const edits = parseEdits(args);

    return await withFileMutationQueue(path, async () => {
      const raw = await readFile(path, "utf8").catch((error: unknown) => {
        if (isErrnoException(error) && error.code === "ENOENT") {
          throw editError(
            "EDIT_FILE_NOT_FOUND",
            `file not found: ${shown}. Use write to create it.`,
            { path },
          );
        }
        throw error;
      });
      if (raw.includes("\0")) {
        throw editError(
          "EDIT_BINARY_FILE",
          `${shown} appears to be a binary file.`,
          { path },
        );
      }

      const bom = raw.startsWith("\uFEFF") ? "\uFEFF" : "";
      const withoutBom = bom ? raw.slice(1) : raw;
      const lineEnding = detectLineEnding(withoutBom);
      const content = normalizeLineEndings(withoutBom);
      const resolved = edits.map((edit, index) =>
        resolveExactEdit(content, edit, index, path, shown),
      );
      rejectOverlappingEdits(resolved, path, shown);

      let updated = content;
      for (const edit of [...resolved].sort(
        (left, right) => right.start - left.start,
      )) {
        updated = `${updated.slice(0, edit.start)}${edit.newText}${updated.slice(edit.end)}`;
      }

      if (updated === content) {
        throw editError("EDIT_NO_CHANGE", `${shown} already contains this text.`, {
          path,
          operationCount: edits.length,
        });
      }

      // Derive details before writing so a failure here cannot misreport a
      // changed file as unapplied.
      const diff = generateDiffString(content, updated);
      const changedLine = firstChangedLine(content, updated);
      await writeTextFileAtomically(
        path,
        bom + restoreLineEndings(updated, lineEnding),
      );

      const contentMessage = `Edited ${shown}: ${edits.length} replacement${edits.length === 1 ? "" : "s"}, ${describeLineRanges(changedRanges(resolved, updated))}.`;
      return {
        path,
        content: contentMessage,
        contentBlocks: [{ type: "text", text: contentMessage }],
        details: {
          diff,
          firstChangedLine: changedLine,
          lineEnding,
          bom: Boolean(bom),
          operationCount: edits.length,
          appliedCount: edits.length,
          operations: resolved.map((edit) => ({
            index: edit.index,
            status: "applied",
            type: "replace_text",
            source: "edits",
            sourceIndex: edit.index,
            matchCount: 1,
            startLine: edit.startLine,
            endLine: edit.endLine,
            matchedBy: "unique",
          })),
          mutationSummary: {
            operation: "edit",
            outcome: "succeeded",
            resources: [{ kind: "file", path }],
            warnings: [],
          },
        },
      };
    });
  } catch (error) {
    const details = error instanceof ToolExecutionError ? error.details : {};
    const failedIndex =
      details.operationIndex ?? details.index ?? details.currentIndex;
    const operations = (Array.isArray(args.edits) ? args.edits : []).map(
      (_, index) => ({
        index,
        type: "replace_text",
        source: "edits",
        sourceIndex: index,
        status: index === failedIndex ? "failed" : "not_applied",
        ...(index === failedIndex
          ? { error: error instanceof Error ? error.message : String(error) }
          : {}),
      }),
    );
    throw new ToolExecutionError(
      error instanceof ToolExecutionError ? error.code : "EDIT_FAILED",
      error instanceof Error ? error.message : String(error),
      {
        ...details,
        appliedCount: 0,
        operationCount: operations.length,
        operations,
      },
      error instanceof ToolExecutionError && error.retryable,
    );
  }
}

function parseEdits(args: Record<string, unknown>): ExactEdit[] {
  const allowedArgs = new Set(["path", "edits"]);
  const unexpected = Object.keys(args).filter((key) => !allowedArgs.has(key));
  if (unexpected.length > 0) {
    throw argumentError(
      `edit received unsupported argument${unexpected.length === 1 ? "" : "s"}: ${unexpected.join(", ")}. Use only path and edits.`,
      { unexpected },
    );
  }
  if (!Array.isArray(args.edits) || args.edits.length === 0) {
    throw argumentError(
      "Tool argument 'edits' must contain at least one item.",
    );
  }
  return args.edits.map((value, index) => {
    const label = `edits[${index}]`;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw argumentError(`${label} must be an object.`, { index });
    }
    const record = value as Record<string, unknown>;
    const unexpectedFields = Object.keys(record).filter(
      (key) => key !== "oldText" && key !== "newText",
    );
    if (unexpectedFields.length > 0) {
      throw argumentError(
        `${label} contains unsupported field${unexpectedFields.length === 1 ? "" : "s"}: ${unexpectedFields.join(", ")}.`,
        { index, unexpected: unexpectedFields },
      );
    }
    if (typeof record.oldText !== "string" || record.oldText.length === 0) {
      throw argumentError(`${label}.oldText must be a non-empty string.`, {
        index,
      });
    }
    if (typeof record.newText !== "string") {
      throw argumentError(`${label}.newText must be a string.`, { index });
    }
    const oldText = normalizeLineEndings(record.oldText);
    const newText = normalizeLineEndings(record.newText);
    if (oldText === newText) {
      throw editError(
        "EDIT_NO_CHANGE",
        `${label}: file already contains this text (oldText equals newText).`,
        { operationIndex: index },
      );
    }
    return { oldText, newText };
  });
}

function resolveExactEdit(
  content: string,
  edit: ExactEdit,
  index: number,
  path: string,
  shown: string,
): ResolvedEdit {
  const matches = exactMatchOffsets(content, edit.oldText);
  if (matches.length === 0) {
    throw editError(
      "EDIT_MATCH_NOT_FOUND",
      notFoundMessage(content, edit.oldText, index, shown),
      { path, operationIndex: index, operationType: "replace_text" },
      true,
    );
  }
  if (matches.length > 1) {
    throw editError(
      "EDIT_MATCH_AMBIGUOUS",
      ambiguousMessage(content, matches, index),
      {
        path,
        operationIndex: index,
        operationType: "replace_text",
        matchCount: matches.length,
      },
      true,
    );
  }
  const start = matches[0] ?? 0;
  const end = start + edit.oldText.length;
  return {
    index,
    start,
    end,
    newText: edit.newText,
    startLine: lineAtOffset(content, start),
    endLine: lineAtOffset(content, Math.max(start, end - 1)),
  };
}

function exactMatchOffsets(content: string, needle: string): number[] {
  const matches: number[] = [];
  let offset = content.indexOf(needle);
  while (offset >= 0) {
    matches.push(offset);
    offset = content.indexOf(needle, offset + 1);
  }
  return matches;
}

function lineAtOffset(content: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < Math.min(offset, content.length); index += 1) {
    if (content[index] === "\n") line += 1;
  }
  return line;
}

function rejectOverlappingEdits(
  edits: ResolvedEdit[],
  path: string,
  shown: string,
): void {
  const ordered = [...edits].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (!previous || !current || current.start >= previous.end) continue;
    throw editError(
      "EDIT_OVERLAP",
      `edits[${current.index}] overlaps edits[${previous.index}] in ${shown}. Merge overlapping changes into one edit.`,
      {
        path,
        previousIndex: previous.index,
        currentIndex: current.index,
      },
      true,
    );
  }
}

const MAX_LISTED_MATCHES = 5;
const MAX_SNIPPET = 80;

function snippet(line: string | undefined): string {
  const text = (line ?? "").trim();
  return text.length > MAX_SNIPPET ? `${text.slice(0, MAX_SNIPPET)}…` : text;
}

function ambiguousMessage(
  content: string,
  matches: number[],
  index: number,
): string {
  const lines = content.split("\n");
  const found = matches.map((offset) => {
    const number = lineAtOffset(content, offset);
    const neighbour = (step: number): string => {
      for (let n = number - 1 + step; n >= 0 && n < lines.length; n += step) {
        const text = snippet(lines[n]);
        if (text) return text;
      }
      return "";
    };
    return {
      number,
      line: snippet(lines[number - 1]),
      before: neighbour(-1),
      after: neighbour(1),
    };
  });
  // Prefer the neighbour that differs between matches.
  const distinct = (key: "before" | "after") =>
    new Set(found.map((match) => match[key])).size;
  const useAfter = distinct("before") < 2 && distinct("after") > 1;
  const listed = found.slice(0, MAX_LISTED_MATCHES).map((match) => {
    const after = match.before && `(after: ${match.before})`;
    const before = match.after && `(before: ${match.after})`;
    const hint = useAfter ? before || after : after || before;
    return `  ${match.number}: ${match.line}${hint ? `  ${hint}` : ""}`;
  });
  const rest = found.length - listed.length;
  return [
    `edits[${index}].oldText matched ${matches.length} times. Add context that tells them apart:`,
    ...listed,
    ...(rest > 0 ? [`  … and ${rest} more`] : []),
  ].join("\n");
}

function notFoundMessage(
  content: string,
  oldText: string,
  index: number,
  shown: string,
): string {
  const base = `edits[${index}].oldText was not found in ${shown}. Reread the file and use exact current text.`;
  const needle = collapseWhitespace(oldText);
  if (needle.text.length === 0) return base;
  const haystack = collapseWhitespace(content);
  const at = haystack.text.indexOf(needle.text);
  if (at < 0) return base;
  const offset = haystack.origins[at] ?? 0;
  const number = lineAtOffset(content, offset);
  const line = snippet(content.split("\n")[number - 1]);
  return `edits[${index}].oldText was not found in ${shown}; only whitespace differs from line ${number}: ${line}`;
}

/** Collapses whitespace runs to one space and trims, tracking original offsets. */
function collapseWhitespace(input: string): {
  text: string;
  origins: number[];
} {
  let text = "";
  const origins: number[] = [];
  let pendingSpace = -1;
  for (let i = 0; i < input.length; i += 1) {
    if (/\s/.test(input[i] ?? "")) {
      if (pendingSpace < 0) pendingSpace = i;
      continue;
    }
    if (pendingSpace >= 0 && text.length > 0) {
      text += " ";
      origins.push(pendingSpace);
    }
    pendingSpace = -1;
    text += input[i];
    origins.push(i);
  }
  return { text, origins };
}

type LineRange = { start: number; end: number };

/** Line ranges of the replaced regions in the updated content, merged. */
function changedRanges(resolved: ResolvedEdit[], updated: string): LineRange[] {
  const ranges: LineRange[] = [];
  let shift = 0;
  for (const edit of [...resolved].sort((a, b) => a.start - b.start)) {
    const start = edit.start + shift;
    shift += edit.newText.length - (edit.end - edit.start);
    const range = {
      start: lineAtOffset(updated, start),
      end: lineAtOffset(updated, Math.max(start, start + edit.newText.length - 1)),
    };
    const last = ranges[ranges.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      ranges.push(range);
    }
  }
  return ranges;
}

function describeLineRanges(ranges: LineRange[]): string {
  const parts = ranges
    .slice(0, MAX_LISTED_MATCHES)
    .map(({ start, end }) => (start === end ? `${start}` : `${start}-${end}`));
  const rest = ranges.length - parts.length;
  const noun = ranges.length === 1 && parts[0] && !parts[0].includes("-") ? "line" : "lines";
  if (rest > 0) return `${noun} ${parts.join(", ")} and ${rest} more`;
  const last = parts.pop();
  return `${noun} ${parts.length > 0 ? `${parts.join(", ")} and ` : ""}${last}`;
}
