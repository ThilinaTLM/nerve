import { readFile } from "node:fs/promises";
import type { ToolExecutionContext, ToolExecutionResult } from "../types.js";
import { writeTextFileAtomically } from "./atomic-write.js";
import { resolveToolPath } from "./path.js";

type NormalizedEdit = { oldText: string; newText: string };

export async function executeEdit(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const path = resolveToolPath(context.cwd, args.path);
  const edits = normalizeEditOperations(args);
  const content = await readFile(path, "utf8");
  const matches = edits.map((edit, index) => {
    const first = content.indexOf(edit.oldText);
    if (first < 0) throw new Error(`edits[${index}].oldText was not found.`);
    if (content.indexOf(edit.oldText, first + edit.oldText.length) >= 0) {
      throw new Error(
        `edits[${index}].oldText matched more than once; provide a unique region.`,
      );
    }
    return { ...edit, index, start: first, end: first + edit.oldText.length };
  });

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
  await writeTextFileAtomically(path, updated);
  return { path, content: `Edited file with ${edits.length} replacement(s).` };
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
