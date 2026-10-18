import type { Activity } from "@nervekit/contracts/activity";
import {
  gitOperationTitle,
  gitBulkOperationTitle,
  type GitOperationStartRequest,
  type GitOperationBulkStartRequest,
  type GitOperationBulkStartResponse,
} from "@nervekit/contracts/git";
import type { ActivityStartedObserver } from "$lib/application/activity/activity-state.svelte";

export function observeGitOperationStart(
  observer: ActivityStartedObserver,
  input: GitOperationStartRequest,
  operationId: string,
): void {
  observer.observeStarted({
    id: operationId,
    kind: `git.${input.kind}`,
    title: gitOperationTitle(input),
    scope: { projectId: input.projectId, repositoryPath: input.repo },
  });
}

export function observeBulkGitOperationStart(
  observer: ActivityStartedObserver,
  input: GitOperationBulkStartRequest,
  result: GitOperationBulkStartResponse,
): void {
  observer.observeStarted({
    id: result.operationId,
    kind: `git.${input.kind}.all`,
    title: gitBulkOperationTitle(input.kind),
    scope: { projectId: input.projectId },
  });
  // The server returns children in first-occurrence repository order.
  const repos = [...new Set(input.repos)];
  result.childOperationIds.forEach((id, index) => {
    observer.observeStarted({
      id,
      parentId: result.operationId,
      kind: `git.${input.kind}`,
      title: gitOperationTitle({
        kind: input.kind,
        repo: repos[index] ?? "repository",
      }),
      scope: { projectId: input.projectId, repositoryPath: repos[index] },
    });
  });
}

/** Activity IDs, not the lifetime of the start RPC, own remote busy/progress state. */
export function gitRunningOperations(
  activities: readonly Activity[],
  projectId: string,
  repo?: string,
): Activity[] {
  return activities.filter(
    (activity) =>
      activity.kind.startsWith("git.") &&
      activity.scope?.projectId === projectId &&
      (repo === undefined ||
        activity.scope.repositoryPath === repo ||
        activity.kind.endsWith(".all")) &&
      (activity.status === "queued" || activity.status === "running"),
  );
}
export function gitRemoteBusy(
  activities: readonly Activity[],
  projectId: string,
  repo: string,
) {
  const active = gitRunningOperations(activities, projectId, repo).filter(
    (activity) => activity.scope?.repositoryPath === repo,
  );
  const has = (kind: string) =>
    active.some((activity) => activity.kind === `git.${kind}`);
  return {
    operationIds: active.map((activity) => activity.id),
    fetching: has("fetch"),
    pulling: has("pull"),
    pushing: has("push"),
    syncing: has("sync"),
    switchingBaseAndPulling: has("switchBaseAndPull"),
  };
}
