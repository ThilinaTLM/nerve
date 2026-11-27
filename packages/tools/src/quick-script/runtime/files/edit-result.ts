import { SCRIPT_EDIT_DIFF_BYTES } from "../../limits.js";
import type { SdkEnvironment } from "../sdk-types.js";
import { freshArtifactName, writeArtifact } from "./artifacts.js";
import type { EditOutcome } from "./file-edits.js";

/** What `files.edit` and `artifacts.edit` return: the diff is capped, the full one saved as an artifact. */
export async function editResult(
  outcome: EditOutcome,
  env: SdkEnvironment,
  dryRun: boolean,
) {
  const base = { files: outcome.files, ...(dryRun ? { dryRun: true } : {}) };
  if (Buffer.byteLength(outcome.diff) <= SCRIPT_EDIT_DIFF_BYTES)
    return { ...base, diff: outcome.diff };
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
    return {
      ...base,
      diff: `${shown}\n[diff truncated; full diff: ${diffFile}]`,
      diffFile,
    };
  } catch {
    return { ...base, diff: `${shown}\n[diff truncated]` };
  }
}
