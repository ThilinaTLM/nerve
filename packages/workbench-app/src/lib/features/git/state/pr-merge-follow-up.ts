import type {
  GitOperationStartRequest,
  GitOperationStartResponse,
} from "@nervekit/contracts/git";
import type { ActivityStartedObserver } from "$lib/application/activity/activity-state.svelte";
import { observeGitOperationStart } from "./git-operation-tracking";

/** Merge has already succeeded; this only queues and acknowledges the local update. */
export async function queueMergedPrFollowUp(
  input: {
    projectId: string;
    repo: string;
    number: number;
    baseBranch: string;
  },
  deps: {
    start(input: GitOperationStartRequest): Promise<GitOperationStartResponse>;
    activities: ActivityStartedObserver;
    notify(message: string): void;
  },
): Promise<void> {
  const operation: GitOperationStartRequest = {
    projectId: input.projectId,
    repo: input.repo,
    kind: "switchBaseAndPull",
    baseBranch: input.baseBranch,
  };
  const { operationId } = await deps.start(operation);
  observeGitOperationStart(deps.activities, operation, operationId);
  deps.notify(
    `Merged pull request #${input.number}; ${input.baseBranch} update queued in Activity`,
  );
}
