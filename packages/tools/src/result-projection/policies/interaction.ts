import { humanCandidate, lifecycleCandidate, policy } from "./common.js";
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
