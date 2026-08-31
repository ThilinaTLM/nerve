import { readFile } from "node:fs/promises";
import type {
  FilesystemExecutionContext,
  ToolExecutionResult,
} from "../execution-context.js";
import { writeTextFileAtomically } from "./atomic-write.js";
import { argumentError, editError } from "./edit-errors.js";
import { withFileMutationQueue } from "./file-mutation-queue.js";
import { resolveToolPath } from "./path.js";
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
  const edits = parseEdits(args);

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
    const resolved = edits.map((edit, index) =>
      resolveExactEdit(content, edit, index, path),
    );
    rejectOverlappingEdits(resolved, path);

    let updated = content;
    for (const edit of [...resolved].sort(
      (left, right) => right.start - left.start,
    )) {
      updated = `${updated.slice(0, edit.start)}${edit.newText}${updated.slice(edit.end)}`;
    }

    if (updated === content) {
      throw editError("EDIT_NO_CHANGE", `edit would not change ${path}.`, {
        path,
        operationCount: edits.length,
      });
    }

    await writeTextFileAtomically(
      path,
      bom + restoreLineEndings(updated, lineEnding),
    );

    const contentMessage = `Edited file with ${edits.length} replacement${edits.length === 1 ? "" : "s"}.`;
    return {
      path,
      content: contentMessage,
      contentBlocks: [{ type: "text", text: contentMessage }],
      details: {
        diff: generateDiffString(content, updated),
        firstChangedLine: firstChangedLine(content, updated),
        lineEnding,
        bom: Boolean(bom),
        operationCount: edits.length,
        operations: resolved.map((edit) => ({
          index: edit.index,
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
      throw argumentError(`${label} must be an object.`);
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
      throw editError("EDIT_NO_CHANGE", `${label} would not change the file.`, {
        operationIndex: index,
      });
    }
    return { oldText, newText };
  });
}

function resolveExactEdit(
  content: string,
  edit: ExactEdit,
  index: number,
  path: string,
): ResolvedEdit {
  const matches = exactMatchOffsets(content, edit.oldText);
  if (matches.length === 0) {
    throw editError(
      "EDIT_MATCH_NOT_FOUND",
      `edits[${index}].oldText was not found in ${path}. Reread the file and use exact current text.`,
      { path, operationIndex: index, operationType: "replace_text" },
      true,
    );
  }
  if (matches.length > 1) {
    throw editError(
      "EDIT_MATCH_AMBIGUOUS",
      `edits[${index}].oldText matched ${matches.length} times in ${path}. Include more surrounding context so it is unique.`,
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

function rejectOverlappingEdits(edits: ResolvedEdit[], path: string): void {
  const ordered = [...edits].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (!previous || !current || current.start >= previous.end) continue;
    throw editError(
      "EDIT_OVERLAP",
      `edits[${current.index}] overlaps edits[${previous.index}] in ${path}. Merge overlapping changes into one edit.`,
      {
        path,
        previousIndex: previous.index,
        currentIndex: current.index,
      },
      true,
    );
  }
}
