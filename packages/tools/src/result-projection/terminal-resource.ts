import type { CandidateContext, TerminalResource } from "./types.js";
import { record, firstString } from "./candidate-values.js";

export function safeTerminalResource(
  context: CandidateContext,
): TerminalResource | undefined {
  const args = record(context.args);
  const result = record(context.result);
  const details = record(result.details);
  const value = firstString(
    result.path,
    details.path,
    details.url,
    args.path,
    args.taskId,
    result.taskId,
    details.taskId,
    result.issueKey,
    details.issueKey,
    result.pageId,
    details.pageId,
    result.reviewId,
    details.reviewId,
  );
  if (!value) return;
  return {
    label: sanitizeUrl(value),
    state: firstString(
      result.status,
      details.status,
      result.state,
      details.state,
    ),
  };
}

export function sanitizeUrl(value: string): string {
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
