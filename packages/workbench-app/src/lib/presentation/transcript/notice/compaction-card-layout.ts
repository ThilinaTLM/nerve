import type { CompactionNoticeState } from "../../state/transcript-types";

export type CompactionCardBodyKind = "none" | "status" | "preview";

export function compactionCardBodyKind(input: {
  bodyVisible: boolean;
  previewVisible: boolean;
}): CompactionCardBodyKind {
  if (!input.bodyVisible) return "none";
  return input.previewVisible ? "preview" : "status";
}

/**
 * Full-card structural milestone. Preview text is intentionally excluded so
 * streamed deltas do not restart geometry and content motion for every token.
 */
export function compactionCardLayoutRevision(input: {
  state: CompactionNoticeState;
  bodyKind: CompactionCardBodyKind;
  errorVisible: boolean;
  footerItemCount: number;
}): string {
  return [
    input.state,
    `body:${input.bodyKind}`,
    input.errorVisible ? "error" : "no-error",
    input.footerItemCount > 0 ? `footer:${input.footerItemCount}` : "no-footer",
  ].join("|");
}
