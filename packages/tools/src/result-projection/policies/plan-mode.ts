import { humanCandidate } from "../candidates/interaction.js";
import { policy } from "./define-policy.js";
export const planReviewAgentResultPolicy = policy(
  "human_response",
  "continuation_aware",
  humanCandidate,
);
