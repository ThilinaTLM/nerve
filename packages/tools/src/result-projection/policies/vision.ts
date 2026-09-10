import { policy } from "./define-policy.js";
import { textCandidate } from "../candidates/text.js";
export const explainImageAgentResultPolicy = policy(
  "vision_explanation",
  "head",
  textCandidate,
);
