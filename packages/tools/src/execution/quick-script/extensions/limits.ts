import { HTML_CONVERSION_MAX_INPUT_BYTES } from "../../atlassian/isolated-html-to-markdown.js";
import { MAX_ATTACHMENT_BYTES, MAX_FILE_BYTES } from "../files/artifacts.js";
import { MAX_SOURCE_BYTES } from "./diagram/diagram-methods.js";

/** Limits stated in docs and rules as `{{limit:<name>}}`; the values come from the code that enforces them. */
const LIMIT_BYTES: Record<string, number> = {
  "files.read": MAX_FILE_BYTES,
  "files.write": MAX_FILE_BYTES,
  attachments: MAX_ATTACHMENT_BYTES,
  "diagram.source": MAX_SOURCE_BYTES,
  "web.fetch": HTML_CONVERSION_MAX_INPUT_BYTES,
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 && bytes % (1024 * 1024) === 0)
    return `${bytes / (1024 * 1024)} MiB`;
  if (bytes >= 1024 && bytes % 1024 === 0) return `${bytes / 1024} KiB`;
  return `${bytes} bytes`;
}

/** Fills `{{limit:name}}` placeholders; an unknown name throws so a typo cannot ship. */
export function renderLimits(text: string): string {
  return text.replace(/\{\{limit:([\w.]+)\}\}/g, (_, name: string) => {
    const bytes = LIMIT_BYTES[name];
    if (bytes === undefined) throw new Error(`Unknown limit '${name}'.`);
    return formatBytes(bytes);
  });
}
