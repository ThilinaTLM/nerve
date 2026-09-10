import { humanCandidate } from "../candidates/interaction.js";
import { mutationCandidate } from "../candidates/mutation.js";
import { policy } from "./define-policy.js";
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
