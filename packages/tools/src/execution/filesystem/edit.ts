import { readFile } from "node:fs/promises";
import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { writeTextFileAtomically } from "./atomic-write.js";
import { withFileMutationQueue } from "./file-mutation-queue.js";
import { resolveToolPath } from "./path.js";

type NormalizedEdit = { oldText: string; newText: string };
type Match = NormalizedEdit & { index: number; start: number; end: number };

export async function executeEdit(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const path = resolveToolPath(context.cwd, args.path);
  const edits = normalizeEditOperations(args);
  return withFileMutationQueue(path, async () => {
    const raw = await readFile(path, "utf8");
    const bom = raw.startsWith("\uFEFF") ? "\uFEFF" : "";
    const withoutBom = bom ? raw.slice(1) : raw;
    const lineEnding = detectLineEnding(withoutBom);
    const content = normalizeLineEndings(withoutBom);
    const normalizedEdits = edits.map((edit) => ({
      oldText: normalizeLineEndings(edit.oldText),
      newText: normalizeLineEndings(edit.newText),
    }));

    const matches = normalizedEdits.map((edit, index) =>
      findUniqueMatch(content, edit, index),
    );
    const ordered = [...matches].sort((a, b) => a.start - b.start);
    for (let i = 1; i < ordered.length; i++) {
      const previous = ordered[i - 1];
      const current = ordered[i];
      if (!previous || !current) continue;
      if (current.start < previous.end) {
        throw new Error(
          `edits[${current.index}] overlaps edits[${previous.index}]; merge overlapping changes.`,
        );
      }
    }

    let updated = content;
    for (const edit of [...ordered].reverse()) {
      updated = `${updated.slice(0, edit.start)}${edit.newText}${updated.slice(edit.end)}`;
    }
    if (updated === content) {
      throw new Error("Edit would not change the file.");
    }

    const restored = bom + restoreLineEndings(updated, lineEnding);
    await writeTextFileAtomically(path, restored);
    const contentMessage = `Edited file with ${edits.length} replacement(s).`;
    return {
      path,
      content: contentMessage,
      contentBlocks: [{ type: "text", text: contentMessage }],
      details: {
        diff: generateDiffString(content, updated),
        firstChangedLine: firstChangedLine(content, updated),
        lineEnding,
        bom: Boolean(bom),
      },
    };
  });
}

function findUniqueMatch(
  content: string,
  edit: NormalizedEdit,
  index: number,
): Match {
  const first = content.indexOf(edit.oldText);
  if (first >= 0) {
    if (content.indexOf(edit.oldText, first + edit.oldText.length) >= 0) {
      throw new Error(
        `edits[${index}].oldText matched more than once; provide a unique region.`,
      );
    }
    return { ...edit, index, start: first, end: first + edit.oldText.length };
  }

  const fuzzy = fuzzyFind(content, edit.oldText);
  if (!fuzzy) throw new Error(`edits[${index}].oldText was not found.`);
  if (fuzzy.duplicate) {
    throw new Error(
      `edits[${index}].oldText matched more than once; provide a unique region.`,
    );
  }
  return { ...edit, index, start: fuzzy.start, end: fuzzy.end };
}

function fuzzyFind(
  content: string,
  needle: string,
): { start: number; end: number; duplicate: boolean } | undefined {
  const normalizedNeedle = normalizeForFuzzyMatch(needle);
  const lines = content.split("\n");
  const needleLineCount = needle.split("\n").length;
  const matches: Array<{ start: number; end: number }> = [];
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  for (let line = 0; line < lines.length; line += 1) {
    for (
      let count = Math.max(1, needleLineCount - 1);
      count <= needleLineCount + 1;
      count += 1
    ) {
      const chunk = lines.slice(line, line + count).join("\n");
      if (normalizeForFuzzyMatch(chunk) !== normalizedNeedle) continue;
      const start = offsets[line] ?? 0;
      const end = start + chunk.length;
      matches.push({ start, end });
    }
  }
  const first = matches[0];
  if (!first) return undefined;
  return { ...first, duplicate: matches.length > 1 };
}

function normalizeForFuzzyMatch(input: string): string {
  return normalizeLineEndings(input)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function detectLineEnding(input: string): "\n" | "\r\n" {
  const crlf = input.match(/\r\n/g)?.length ?? 0;
  const lf = input.match(/(?<!\r)\n/g)?.length ?? 0;
  return crlf > lf ? "\r\n" : "\n";
}

function normalizeLineEndings(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function restoreLineEndings(input: string, lineEnding: "\n" | "\r\n"): string {
  return lineEnding === "\n" ? input : input.replace(/\n/g, "\r\n");
}

function firstChangedLine(before: string, after: string): number | undefined {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const length = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < length; index += 1) {
    if (beforeLines[index] !== afterLines[index]) return index + 1;
  }
  return undefined;
}

function generateDiffString(before: string, after: string): string {
  const line = firstChangedLine(before, after) ?? 1;
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const start = Math.max(0, line - 3);
  const end = Math.min(
    Math.max(beforeLines.length, afterLines.length),
    line + 3,
  );
  const output = [
    `@@ -${start + 1},${end - start} +${start + 1},${end - start} @@`,
  ];
  for (let index = start; index < end; index += 1) {
    const beforeLine = beforeLines[index];
    const afterLine = afterLines[index];
    if (beforeLine === afterLine) output.push(` ${beforeLine ?? ""}`);
    else {
      if (beforeLine !== undefined) output.push(`-${beforeLine}`);
      if (afterLine !== undefined) output.push(`+${afterLine}`);
    }
  }
  return output.join("\n");
}

export function normalizeEditOperations(
  args: Record<string, unknown>,
): NormalizedEdit[] {
  if (Array.isArray(args.edits)) {
    if (args.edits.length === 0) {
      throw new Error("Tool argument 'edits' must contain at least one edit.");
    }
    return args.edits.map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(`edits[${index}] must be an object.`);
      }
      const edit = entry as Record<string, unknown>;
      if (typeof edit.oldText !== "string" || edit.oldText.length === 0) {
        throw new Error(`edits[${index}].oldText must be a non-empty string.`);
      }
      if (typeof edit.newText !== "string") {
        throw new Error(`edits[${index}].newText must be a string.`);
      }
      return { oldText: edit.oldText, newText: edit.newText };
    });
  }

  if (typeof args.oldText !== "string" || args.oldText.length === 0) {
    throw new Error("Tool argument 'oldText' must be a non-empty string.");
  }
  if (typeof args.newText !== "string") {
    throw new Error("Tool argument 'newText' must be a string.");
  }
  return [{ oldText: args.oldText, newText: args.newText }];
}
