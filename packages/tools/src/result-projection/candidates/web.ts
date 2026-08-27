import { measureBlocks } from "../measure.js";
import { profileBudget } from "../profiles.js";

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
  return [...metadata, body].join("\n\n");
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

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/token|key|auth|signature|credential|password|secret/i.test(key))
        url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return value;
  }
}
