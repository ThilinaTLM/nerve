import type { CandidateContext, ProjectionCandidate } from "../types.js";
import { primaryFileCandidate } from "./primary-file.js";
import { record, string, textOf } from "../candidate-values.js";

/**
 * Managed exports are announced through their validated artifact. Files the
 * agent placed with output_path are never claimed as artifacts, so the path is
 * reported directly.
 */
export function krokiCandidate(context: CandidateContext): ProjectionCandidate {
  const candidate = primaryFileCandidate(context);
  const managed = candidate.artifacts.some(
    (artifact) =>
      artifact.role === "primary_result" &&
      artifact.availability === "available",
  );
  const path = string(record(record(context.result).details).path);
  if (managed || !path) return candidate;
  const text = [textOf(candidate.blocks), `Exported diagram: ${path}`]
    .filter(Boolean)
    .join("\n");
  const blocks = [{ type: "text" as const, text }];
  return { ...candidate, blocks, status: blocks };
}
