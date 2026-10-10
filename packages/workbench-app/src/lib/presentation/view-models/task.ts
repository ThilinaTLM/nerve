import type { AsyncBash } from "@nervekit/contracts/core";
import type { TaskLogEvent } from "@nervekit/contracts/tasks";
import type {
  TaskToolSummaryPayload as ContractTaskSummary,
  TaskCancelOutcomePreviewPayload as ContractCancelOutcome,
} from "@nervekit/contracts/tools";

/** View data preserves async-bash IDs/statuses and omits unreported readiness. */
export type TaskToolSummaryPayload = Omit<
  ContractTaskSummary,
  "status" | "readiness"
> & {
  status: ContractTaskSummary["status"] | AsyncBash["status"];
  readiness?: ContractTaskSummary["readiness"];
};

export type TaskCancelOutcomePreviewPayload = Omit<
  ContractCancelOutcome,
  "task" | "status" | "outcome" | "message"
> & {
  task?: TaskToolSummaryPayload;
  status?: TaskToolSummaryPayload["status"];
  outcome?: ContractCancelOutcome["outcome"];
  message?: string;
};

/** Core log output is a text chunk, not a sequence of structured task events. */
export type TaskLogDisplayEvent = Pick<TaskLogEvent, "line"> &
  Partial<Omit<TaskLogEvent, "line">>;
