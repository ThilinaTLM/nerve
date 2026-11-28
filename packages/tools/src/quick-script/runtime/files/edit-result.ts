import { SCRIPT_EDIT_DIFF_BYTES } from "../../limits.js";
import { callDetails } from "../call-log.js";
import type { SdkEnvironment } from "../sdk-types.js";
import { freshArtifactName, writeArtifact } from "./artifacts.js";
import type { EditOutcome } from "./file-edits.js";

/** `[0] 6 in 3 files, [1] 1 in 1 file`: each edit's matches over the files it touched. */
function matchSummary(files: EditOutcome["files"]): string {
  const totals = new Map<number, { matches: number; files: number }>();
  for (const file of files)
    for (const { index, matches } of file.edits) {
      const total = totals.get(index) ?? { matches: 0, files: 0 };
      total.matches += matches;
      if (matches > 0) total.files += 1;
      totals.set(index, total);
    }
  return [...totals]
    .sort(([a], [b]) => a - b)
    .map(
      ([index, { matches, files }]) =>
        `[${index}] ${matches} in ${files} file${files === 1 ? "" : "s"}`,
    )
    .join(", ");
}

/**
 * What `files.edit` and `artifacts.edit` return: the diff is capped, the full
 * one saved as an artifact. The run's result names each edit's match count, so
 * a script need not print anything to have the edit verified; the tool card
 * gets the diff through the call record.
 */
export async function editResult(
  outcome: EditOutcome,
  env: SdkEnvironment,
  dryRun: boolean,
  /** `transform` edits have no match counts to report. */
  counted = true,
) {
  const base = {
    files: outcome.files,
    ...(dryRun ? { dryRun: true } : {}),
    // Read and removed by the prelude: a transform's result prints without match counts.
    ...(counted ? {} : { counted: false }),
  };
  let result: typeof base & { diff: string; diffFile?: string };
  if (Buffer.byteLength(outcome.diff) <= SCRIPT_EDIT_DIFF_BYTES)
    result = { ...base, diff: outcome.diff };
  else {
    const shown = Buffer.from(outcome.diff)
      .subarray(0, SCRIPT_EDIT_DIFF_BYTES)
      .toString("utf8")
      .replace(/\uFFFD$/, "");
    try {
      const diffFile = await writeArtifact(
        env,
        await freshArtifactName(env, "edit", ".diff"),
        Buffer.from(outcome.diff),
      );
      result = {
        ...base,
        diff: `${shown}\n[diff truncated; full diff: ${diffFile}]`,
        diffFile,
      };
    } catch {
      result = { ...base, diff: `${shown}\n[diff truncated]` };
    }
  }
  const changed = outcome.files.filter((file) => file.changed);
  const sum = (key: "added" | "removed") =>
    changed.reduce((total, file) => total + file[key], 0);
  const summary = counted
    ? matchSummary(outcome.files)
    : `${changed.length} file${changed.length === 1 ? "" : "s"} changed`;
  env.report.notes.push(
    `${dryRun ? "Dry run, nothing written. " : ""}${counted ? "Edit matches" : "Transform"}: ${summary}`,
  );
  callDetails.set(result, {
    edit: {
      files: changed.length,
      added: sum("added"),
      removed: sum("removed"),
      diff: result.diff,
      ...(result.diffFile ? { diffFile: result.diffFile } : {}),
      ...(dryRun ? { dryRun: true } : {}),
    },
  });
  return result;
}
