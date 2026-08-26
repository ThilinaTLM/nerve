import { lifecycleCandidate, policy, taskLogsCandidate } from "./common.js";
export const taskLifecycleAgentResultPolicy = policy(
  "lifecycle_state",
  "item_aware",
  lifecycleCandidate,
);
export const taskLogsAgentResultPolicy = policy(
  "task_logs",
  "item_aware",
  taskLogsCandidate,
);
