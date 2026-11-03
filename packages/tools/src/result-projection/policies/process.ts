import { policy } from "./define-policy.js";
import { processCandidate } from "../candidates/process.js";
export const processAgentResultPolicy = policy(
  "process_output",
  "head_tail",
  processCandidate,
);
/** Scripts print what the agent asked for, so they get a larger inline budget. */
export const scriptAgentResultPolicy = policy(
  "script_output",
  "head_tail",
  processCandidate,
);
