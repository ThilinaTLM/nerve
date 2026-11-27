import { MAX_STREAMED_FILE_BYTES } from "@nervekit/extension-api/host";
import { HTML_CONVERSION_MAX_INPUT_BYTES } from "../execution/index.js";
import { MAX_FILE_BYTES } from "./runtime/files/artifacts.js";

/** Per-run sandbox limits, passed to the sandbox and stated in the description. */
export const SCRIPT_MEMORY_BYTES = 256 * 1024 * 1024;
export const SCRIPT_OUTPUT_BYTES = 256 * 1024;
export const SCRIPT_MAX_SDK_CALLS = 200;
/** One `files.edit` / `artifacts.edit` call. */
export const SCRIPT_EDIT_MAX_FILES = 500;
export const SCRIPT_EDIT_MAX_BYTES = 20 * 1024 * 1024;
/** Diff text an edit returns; the full diff goes to an artifact. */
export const SCRIPT_EDIT_DIFF_BYTES = 8 * 1024;

/** Limits stated in docs and rules as `{{limit:<name>}}`; the values come from the code that enforces them (extensions declare theirs in the manifest). */
const LIMIT_BYTES: Record<string, number> = {
  "files.read": MAX_FILE_BYTES,
  "files.write": MAX_FILE_BYTES,
  attachments: MAX_STREAMED_FILE_BYTES,
  "web.fetch": HTML_CONVERSION_MAX_INPUT_BYTES,
  "script.memory": SCRIPT_MEMORY_BYTES,
  "script.output": SCRIPT_OUTPUT_BYTES,
  "edit.bytes": SCRIPT_EDIT_MAX_BYTES,
  "edit.diff": SCRIPT_EDIT_DIFF_BYTES,
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 && bytes % (1024 * 1024) === 0)
    return `${bytes / (1024 * 1024)} MiB`;
  if (bytes >= 1024 && bytes % 1024 === 0) return `${bytes / 1024} KiB`;
  return `${bytes} bytes`;
}

/** Fills `{{limit:name}}` placeholders; an unknown name throws so a typo cannot ship. */
export function renderLimits(
  text: string,
  limits: Readonly<Record<string, number>> = {},
): string {
  return text.replace(/\{\{limit:([\w.]+)\}\}/g, (_, name: string) => {
    const bytes = LIMIT_BYTES[name] ?? limits[name];
    if (bytes === undefined) throw new Error(`Unknown limit '${name}'.`);
    return formatBytes(bytes);
  });
}
