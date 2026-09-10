import { lifecycleCandidate, taskLogsCandidate } from "../candidates/tasks.js";
import { policy } from "./define-policy.js";

export const taskLifecycleAgentResultPolicy = policy(
  "lifecycle_state",
  "item_aware",
  lifecycleCandidate,
);
export const taskLogsAgentResultPolicy = policy(
  "task_logs",
  "task_log_window",
  taskLogsCandidate,
);
