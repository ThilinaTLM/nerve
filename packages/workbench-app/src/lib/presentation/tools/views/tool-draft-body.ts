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

export function progressDraftBody(
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
  return undefined;
}

/**
 * Whether a draft has content worth expanding below the persistent header.
 * Header-only arguments (for example a one-line command or path) deliberately
 * do not create an empty placeholder body.
 */
export function hasMeaningfulToolDraftBody(summary: ToolDraftSummary): boolean {
  const argumentBody = summary.argumentBody;
  return Boolean(
    summary.preview?.length ||
    summary.inputPreview?.length ||
    (argumentBody && argumentBody.kind !== "none"),
  );
}
