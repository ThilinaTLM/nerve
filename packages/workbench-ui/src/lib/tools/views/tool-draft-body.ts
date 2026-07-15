import type { ToolDraftSummary } from "./tool-draft-progress";

/**
 * Whether a draft has content worth expanding below the persistent header.
 * Header-only arguments (for example a one-line command or path) deliberately
 * do not create an empty placeholder body.
 */
export function hasMeaningfulToolDraftBody(
  summary: ToolDraftSummary,
  atlassianSummary?: string,
): boolean {
  return Boolean(
    summary.preview?.length ||
    summary.inputPreview?.length ||
    summary.argsPreview?.length ||
    (atlassianSummary?.length &&
      !atlassianSummary.includes("Waiting for arguments…")),
  );
}
