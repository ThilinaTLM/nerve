import { exploreCandidate, policy } from "./common.js";
export const exploreAgentResultPolicy = policy(
  "delegated_reports",
  "compound_per_task",
  exploreCandidate,
);
