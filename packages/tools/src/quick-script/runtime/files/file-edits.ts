import { readFile, stat } from "node:fs/promises";
import { writeTextFileAtomically } from "../../../execution/filesystem/atomic-write.js";
import { withFileMutationQueue } from "../../../execution/filesystem/file-mutation-queue.js";
import {
  detectLineEnding,
  generateDiffString,
  type LineEnding,
  normalizeLineEndings,
  restoreLineEndings,
} from "../../../execution/filesystem/text-editing.js";
import { formatByteSize } from "../../../execution/output/format-bytes.js";
import { SCRIPT_EDIT_MAX_BYTES, SCRIPT_EDIT_MAX_FILES } from "../../limits.js";
import { codedError } from "../errors.js";
import { applyEdit, type ParsedEdit } from "./text-edits.js";

/**
 * Applies `files.edit` / `artifacts.edit` edits to files on disk: every file is
 * read and every edit resolved before anything is written, so a mismatch
 * changes nothing; a failed write restores the files already written.
 */

export type EditFile = {
  /** Absolute path. */
  path: string;
  /** How messages and results name it: a workspace-relative path or an artifact handle. */
  shown: string;
};

export type PlannedEdit = {
  parsed: ParsedEdit;
  files: EditFile[];
  /** Expanded from a glob: a file without a match is skipped; the total must match. */
  glob?: string;
};

export type FileEditResult = {
  path: string;
  changed: boolean;
  edits: { index: number; matches: number }[];
};

export type EditOutcome = {
  files: FileEditResult[];
  /** Per changed file: `--- path` / `+++ path` and the hunks. */
  diff: string;
  /** Contents written, for the run's report. */
  written: { file: EditFile; bytes: number }[];
};

type Loaded = {
  file: EditFile;
  raw: string;
  bom: string;
  lineEnding: LineEnding;
  before: string;
  after: string;
  edits: { index: number; matches: number }[];
};

export async function applyFileEdits(
  planned: readonly PlannedEdit[],
  { dryRun, notFoundHint }: { dryRun: boolean; notFoundHint: string },
): Promise<EditOutcome> {
  const files = new Map<string, EditFile>();
  for (const edit of planned)
    for (const file of edit.files)
      if (!files.has(file.path)) files.set(file.path, file);
  if (files.size > SCRIPT_EDIT_MAX_FILES)
    throw new Error(
      `the edits touch ${files.size} files; the limit is ${SCRIPT_EDIT_MAX_FILES} per call. Split them over several files.edit calls.`,
    );

  const loaded: Loaded[] = [];
  let total = 0;
  for (const file of files.values()) {
    const size = await stat(file.path).then(
      (info) => {
        if (!info.isFile())
          throw new Error(`${file.shown} is not a regular file.`);
        return info.size;
      },
      (error: NodeJS.ErrnoException) => {
        throw error.code === "ENOENT"
          ? codedError(
              "NOT_FOUND",
              `file not found: ${file.shown}. ${notFoundHint}`,
            )
          : error;
      },
    );
    total += size;
    if (total > SCRIPT_EDIT_MAX_BYTES)
      throw new Error(
        `the edited files exceed ${formatByteSize(SCRIPT_EDIT_MAX_BYTES)} per call. Split them over several files.edit calls.`,
      );
    const raw = await readFile(file.path, "utf8");
    if (raw.includes("\0"))
      throw new Error(`${file.shown} appears to be a binary file.`);
    const bom = raw.startsWith("\uFEFF") ? "\uFEFF" : "";
    const body = bom ? raw.slice(1) : raw;
    const before = normalizeLineEndings(body);
    loaded.push({
      file,
      raw,
      bom,
      lineEnding: detectLineEnding(body),
      before,
      after: before,
      edits: [],
    });
  }

  const byPath = new Map(loaded.map((entry) => [entry.file.path, entry]));
  for (const edit of planned) {
    let matched = 0;
    for (const file of edit.files) {
      const entry = byPath.get(file.path)!;
      const result = applyEdit(
        entry.after,
        edit.parsed,
        file.shown,
        edit.glob !== undefined,
      );
      entry.after = result.text;
      matched += result.matches;
      if (result.matches > 0 || edit.glob === undefined)
        entry.edits.push({ index: edit.parsed.index, matches: result.matches });
    }
    if (edit.glob === undefined) continue;
    const { index, count } = edit.parsed;
    if (matched === 0)
      throw new Error(
        `edits[${index}] matched nothing in the ${edit.files.length} files of glob ${JSON.stringify(edit.glob)}.`,
      );
    if (count !== undefined && matched !== count)
      throw new Error(
        `edits[${index}] matched ${matched} times across glob ${JSON.stringify(edit.glob)}; count is ${count}.`,
      );
  }

  const touched = loaded.filter((entry) => entry.edits.length > 0);
  const changed = touched.filter((entry) => entry.after !== entry.before);
  const written: EditOutcome["written"] = [];
  if (!dryRun) {
    try {
      for (const entry of changed) {
        const content =
          entry.bom + restoreLineEndings(entry.after, entry.lineEnding);
        await withFileMutationQueue(entry.file.path, async () => {
          const current = await readFile(entry.file.path, "utf8").catch(
            () => undefined,
          );
          if (current !== entry.raw)
            throw codedError(
              "CONFLICT",
              `${entry.file.shown} changed while the edits were prepared; nothing was written. Read it again and retry.`,
            );
          await writeTextFileAtomically(entry.file.path, content);
        });
        written.push({ file: entry.file, bytes: Buffer.byteLength(content) });
      }
    } catch (error) {
      for (const { file } of written) {
        const entry = byPath.get(file.path)!;
        await withFileMutationQueue(file.path, () =>
          writeTextFileAtomically(file.path, entry.raw),
        ).catch(() => undefined);
      }
      throw error;
    }
  }

  return {
    files: touched.map((entry) => ({
      path: entry.file.shown,
      changed: entry.after !== entry.before,
      edits: entry.edits,
    })),
    diff: changed
      .map(
        (entry) =>
          `--- ${entry.file.shown}\n+++ ${entry.file.shown}\n${generateDiffString(entry.before, entry.after)}`,
      )
      .join("\n"),
    written,
  };
}
