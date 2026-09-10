import { exploreCandidate } from "../candidates/explore.js";
import { policy } from "./define-policy.js";
export const exploreAgentResultPolicy = policy(
  "delegated_reports",
  "compound_per_task",
  exploreCandidate,
);
