import { measureBlocks } from "../measure.js";
import { profileBudget } from "../profiles.js";
import { sanitizeUrl } from "../terminal-resource.js";
import { fallbackText } from "../fallback.js";
import type { CandidateContext, ProjectionCandidate } from "../types.js";
import { artifacts, artifactNoticeLines } from "../candidate-artifacts.js";
import { record } from "../candidate-values.js";

export function webFetchCandidate(
  context: CandidateContext,
): ProjectionCandidate {
  const result = record(context.result);
  const details = record(result.details);
  const validated = artifacts(context);
  const primaryLines = artifactNoticeLines(validated, "primary_result");
  const body =
    primaryLines.length > 0
      ? primaryLines.join("\n")
      : typeof details.savedTo === "string"
        ? "Saved response artifact is unavailable for agent inspection."
        : typeof result.content === "string"
          ? result.content
          : fallbackText(result);
  const canonical = formatWebFetchCandidateText(details, body);
  const metadata = formatWebFetchCandidateText(details, "")
    .trimEnd()
    .split("\n\n")
    .filter(Boolean);
  return {
    blocks: [{ type: "text", text: canonical }],
    status: [
      {
        type: "text",
        text: [...metadata, ...primaryLines].join("\n"),
      },
    ],
    artifacts: validated,
  };
}

export type WebFetchCandidateDetails = {
  url?: unknown;
  status?: unknown;
  contentType?: unknown;
  size?: unknown;
  converted?: unknown;
};

export function formatWebFetchCandidateText(
  details: WebFetchCandidateDetails,
  body: string,
): string {
  const metadata = [
    typeof details.url === "string"
      ? `URL: ${sanitizeUrl(details.url)}`
      : undefined,
    details.status !== undefined
      ? `HTTP status: ${String(details.status)}`
      : undefined,
    typeof details.contentType === "string"
      ? `Content-Type: ${details.contentType}`
      : undefined,
    details.size !== undefined ? `Bytes: ${String(details.size)}` : undefined,
    details.converted === true ? "Converted: markdown" : "Converted: no",
  ].filter((line): line is string => Boolean(line));
  return body ? `${metadata.join("\n")}\n\n${body}` : metadata.join("\n");
}

export function webFetchCandidateFitsInline(
  details: WebFetchCandidateDetails,
  body: string,
): boolean {
  const measured = measureBlocks([
    { type: "text", text: formatWebFetchCandidateText(details, body) },
  ]);
  const budget = profileBudget("network_prose", "inline");
  return measured.bytes <= budget.maxBytes && measured.lines <= budget.maxLines;
}
