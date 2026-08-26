import {
  mutationCandidate,
  policy,
  primaryFileCandidate,
  resourceCandidate,
  searchCandidate,
} from "./common.js";
export const jiraSearchAgentResultPolicy = policy(
  "search_summaries",
  "item_aware",
  searchCandidate,
);
export const jiraResourceAgentResultPolicy = policy(
  "resource_detail",
  "item_aware",
  resourceCandidate,
);
export const jiraDownloadAgentResultPolicy = policy(
  "primary_file_result",
  "artifact_index",
  primaryFileCandidate,
);
export const jiraMutationAgentResultPolicy = policy(
  "mutation_acknowledgement",
  "head",
  mutationCandidate,
);
