import type { ToolArgumentBody } from "../lifecycle/registry";
import type { DraftMetaItem, ToolDraftSummary } from "./tool-draft-progress";

export function mergeDraftMeta(
  preferred: DraftMetaItem[],
  additional: DraftMetaItem[],
): DraftMetaItem[] {
  const seen = new Set<string>();
  return [...preferred, ...additional].filter((item) => {
    if (seen.has(item.text)) return false;
    seen.add(item.text);
    return true;
  });
}

export function specializedDraftBody(
  summary: ToolDraftSummary,
): ToolArgumentBody | undefined {
  if (summary.preview) {
    return summary.kind === "edit"
      ? { kind: "diff", text: summary.preview, tail: true }
      : {
          kind: "code",
          text: summary.preview,
          language: "text",
          tail: true,
        };
  }
  if (summary.inputPreview) {
    return {
      kind: "code",
      text: summary.inputPreview,
      language: summary.language ?? "text",
      tail: true,
    };
  }
  return undefined;
}

/**
 * Whether a draft has content worth expanding below the persistent header.
 * Header-only arguments (for example a one-line command or path) deliberately
 * do not create an empty placeholder body.
 */
export function hasMeaningfulToolDraftBody(
  summary: ToolDraftSummary,
  atlassianSummary?: string,
): boolean {
  const argumentBody = summary.argumentBody;
  const meaningfulArgumentBody =
    argumentBody?.kind === "atlassian-draft"
      ? !summary.done ||
        argumentBody.fields.some((field) => field.value !== undefined) ||
        argumentBody.text?.text !== undefined
      : Boolean(argumentBody && argumentBody.kind !== "none");
  return Boolean(
    summary.preview?.length ||
    summary.inputPreview?.length ||
    meaningfulArgumentBody ||
    (atlassianSummary?.length &&
      !atlassianSummary.includes("Waiting for arguments…")),
  );
}
