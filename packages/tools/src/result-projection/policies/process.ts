import { policy, processCandidate } from "./common.js";
export const processAgentResultPolicy = policy(
  "process_diagnostics",
  "compact_diagnostic",
  processCandidate,
);
