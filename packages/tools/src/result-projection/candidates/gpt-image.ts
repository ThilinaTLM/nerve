import { artifacts } from "../candidate-artifacts.js";
import { fallbackText } from "../fallback.js";
import type { CandidateContext, ProjectionCandidate } from "../types.js";

export function gptImageCandidate(
  context: CandidateContext,
): ProjectionCandidate {
  const validated = artifacts(context);
  const paths = validated.flatMap((artifact) =>
    artifact.role === "primary_result" &&
    artifact.availability === "available" &&
    artifact.access.kind === "agent_file"
      ? [artifact.access.path]
      : [],
  );
  return {
    blocks: [
      { type: "text", text: paths.join("\n") || fallbackText(context.result) },
    ],
    artifacts: validated,
  };
}
