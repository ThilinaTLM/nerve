import { policy } from "./define-policy.js";
import { searchCandidate } from "../candidates/search.js";
import { webFetchCandidate } from "../candidates/web.js";
import type { CandidateContext } from "../types.js";

export const webSearchAgentResultPolicy = policy(
  "search_summaries",
  "item_aware",
  searchCandidate,
);
export const webFetchAgentResultPolicy = policy(
  (context: CandidateContext) => {
    return context.validatedArtifacts.some(
      (artifact) =>
        artifact.role === "primary_result" &&
        artifact.availability === "available",
    )
      ? "primary_file_result"
      : "network_prose";
  },
  "artifact_index",
  webFetchCandidate,
);
