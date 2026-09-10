import { policy } from "./define-policy.js";
import {
  grepCandidate,
  listingCandidate,
  sourceCandidate,
} from "../candidates/filesystem.js";

import { mutationCandidate } from "../candidates/mutation.js";

export const readAgentResultPolicy = policy(
  "source_text",
  "continuation_aware",
  sourceCandidate,
);
export const grepAgentResultPolicy = policy(
  "search_matches",
  "item_aware",
  grepCandidate,
);
export const findAgentResultPolicy = policy(
  "file_listing",
  "item_aware",
  listingCandidate,
);
export const lsAgentResultPolicy = findAgentResultPolicy;
export const editAgentResultPolicy = policy(
  "mutation_acknowledgement",
  "head",
  mutationCandidate,
);
export const writeAgentResultPolicy = editAgentResultPolicy;
