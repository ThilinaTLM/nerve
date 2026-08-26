import { humanCandidate, mutationCandidate, policy } from "./common.js";
export const planMutationAgentResultPolicy = policy(
  "mutation_acknowledgement",
  "head",
  mutationCandidate,
);
export const planReviewAgentResultPolicy = policy(
  "human_response",
  "continuation_aware",
  humanCandidate,
);
