import { policy, searchCandidate, webFetchCandidate } from "./common.js";
import type { CandidateContext } from "../types.js";

export const webSearchAgentResultPolicy = policy(
  "search_summaries",
  "item_aware",
  searchCandidate,
);
export const webFetchAgentResultPolicy = policy(
  (context: CandidateContext) => {
    const result =
      context.result && typeof context.result === "object"
        ? (context.result as Record<string, unknown>)
        : {};
    const details =
      result.details && typeof result.details === "object"
        ? (result.details as Record<string, unknown>)
        : {};
    return details.savedTo ||
      context.validatedArtifacts.some(
        (artifact) => artifact.role === "primary_result",
      )
      ? "primary_file_result"
      : "network_prose";
  },
  "artifact_index",
  webFetchCandidate,
);
