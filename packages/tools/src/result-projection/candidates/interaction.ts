import { fallbackText } from "../fallback.js";
import type { CandidateContext, ProjectionCandidate } from "../types.js";
import { artifacts } from "../candidate-artifacts.js";
import { pickSemantic, formatFlat } from "../candidate-semantic-text.js";
import { record, firstString } from "../candidate-values.js";

export function humanCandidate(context: CandidateContext): ProjectionCandidate {
  const result = record(context.result);
  const details = record(result.details);
  // ask_user returns its canonical result as JSON text.
  const answer = jsonRecord(result.content);
  const response = answer.dismissed
    ? "The user dismissed the question without answering."
    : (firstString(
        result.response,
        result.feedback,
        result.answer,
        details.response,
        details.feedback,
        details.answer,
        answer.response,
        result.content,
      ) ?? fallbackText(result));
  const identity = pickSemantic(
    { ...result, ...details, ...record(result.review) },
    ["reviewId", "planPath", "decision", "outcome", "status", "mode"],
  );
  const prefix =
    Object.keys(identity).length > 0 ? `${formatFlat(identity)}\n\n` : "";
  return {
    blocks: [{ type: "text", text: `${prefix}${response}` }],
    artifacts: artifacts(context),
  };
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.startsWith("{")) return {};
  try {
    return record(JSON.parse(value));
  } catch {
    return {};
  }
}
