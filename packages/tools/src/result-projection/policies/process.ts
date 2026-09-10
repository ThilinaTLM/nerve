import { policy } from "./define-policy.js";
import { processCandidate } from "../candidates/process.js";
export const processAgentResultPolicy = policy(
  "process_diagnostics",
  "compact_diagnostic",
  processCandidate,
);
