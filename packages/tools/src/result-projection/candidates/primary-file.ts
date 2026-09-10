import { fallbackText } from "../fallback.js";
import type { CandidateContext, ProjectionCandidate } from "../types.js";
import { artifacts, artifactNoticeLines } from "../candidate-artifacts.js";
import { pickSemantic, formatFlat } from "../candidate-semantic-text.js";
import { record, number } from "../candidate-values.js";

export function primaryFileCandidate(
  context: CandidateContext,
): ProjectionCandidate {
  const result = record(context.result);
  const details = record(result.details);
  const metadata = pickSemantic(details, [
    "action",
    "attachmentId",
    "filename",
    "mediaType",
    "bytes",
    "bodyFormat",
    "pageCount",
    "displayedPageCount",
    "attachmentCount",
    "downloadDir",
  ]);
  const included = record(details.includedCounts);
  const extra =
    number(included.downloadedAttachments) !== undefined
      ? `downloadedAttachments: ${String(included.downloadedAttachments)}`
      : "";
  const lines = [
    formatFlat(metadata),
    extra,
    ...artifactNoticeLines(artifacts(context), "primary_result"),
  ].filter(Boolean);
  const text = lines.join("\n") || fallbackText(context.result);
  return {
    blocks: [{ type: "text", text }],
    status: [{ type: "text", text }],
    artifacts: artifacts(context),
  };
}
