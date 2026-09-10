import { humanCandidate } from "../candidates/interaction.js";
import { lifecycleCandidate } from "../candidates/tasks.js";
import { policy } from "./define-policy.js";
export const askUserAgentResultPolicy = policy(
  "human_response",
  "continuation_aware",
  humanCandidate,
);
export const todosAgentResultPolicy = policy(
  "lifecycle_state",
  "item_aware",
  lifecycleCandidate,
);
