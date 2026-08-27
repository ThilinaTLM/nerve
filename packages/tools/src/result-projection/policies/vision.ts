import { policy, textCandidate } from "./common.js";
export const explainImageAgentResultPolicy = policy(
  "vision_explanation",
  "head",
  textCandidate,
);
