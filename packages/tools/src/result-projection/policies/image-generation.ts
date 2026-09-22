import { generateImageCandidate } from "../candidates/generate-image.js";
import { policy } from "./define-policy.js";

export const generateImageAgentResultPolicy = policy(
  "vision_explanation",
  "head",
  generateImageCandidate,
);
