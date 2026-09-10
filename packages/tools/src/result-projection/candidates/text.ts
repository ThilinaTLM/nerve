import { fallbackText, validContentBlocks } from "../fallback.js";
import type { CandidateContext, ProjectionCandidate } from "../types.js";
import { artifacts } from "../candidate-artifacts.js";

export function textCandidate(context: CandidateContext): ProjectionCandidate {
  return {
    blocks: validContentBlocks(context.result) ?? [
      { type: "text", text: fallbackText(context.result) },
    ],
    artifacts: artifacts(context),
  };
}
