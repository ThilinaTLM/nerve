import { policy } from "./define-policy.js";
import { webFetchCandidate } from "../candidates/web.js";
import type { CandidateContext } from "../types.js";

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
