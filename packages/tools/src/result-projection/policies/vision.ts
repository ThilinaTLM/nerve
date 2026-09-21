import { policy } from "./define-policy.js";
import { gptImageCandidate } from "../candidates/gpt-image.js";
import { textCandidate } from "../candidates/text.js";
export const explainImageAgentResultPolicy = policy(
  "vision_explanation",
  "head",
  textCandidate,
);
export const gptImageAgentResultPolicy = policy(
  "vision_explanation",
  "head",
  gptImageCandidate,
);
