import {
  mutationCandidate,
  policy,
  primaryFileCandidate,
  resourceCandidate,
  searchCandidate,
} from "./common.js";
export const confluenceSearchAgentResultPolicy = policy(
  "search_summaries",
  "item_aware",
  searchCandidate,
);
export const confluenceResourceAgentResultPolicy = policy(
  "resource_detail",
  "item_aware",
  resourceCandidate,
);
export const confluenceDownloadAgentResultPolicy = policy(
  "primary_file_result",
  "artifact_index",
  primaryFileCandidate,
);
export const confluenceMutationAgentResultPolicy = policy(
  "mutation_acknowledgement",
  "head",
  mutationCandidate,
);
