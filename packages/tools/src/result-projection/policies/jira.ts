import { mutationCandidate } from "../candidates/mutation.js";
import { policy } from "./define-policy.js";
import { primaryFileCandidate } from "../candidates/primary-file.js";
import { resourceCandidate } from "../candidates/resources.js";
import { searchCandidate } from "../candidates/search.js";
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
