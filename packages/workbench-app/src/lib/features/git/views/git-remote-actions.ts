import type { GitRepoSummary } from "@nervekit/contracts/git";
import type { Activity } from "@nervekit/contracts/activity";
import type { GitRemoteOperation } from "./git-panel-types.js";

/** Stop the running command first, never a bulk parent or another repository's work. */
export function activeRemoteOperation(
  activities: readonly Activity[],
  repository: string,
  operation: GitRemoteOperation,
): Activity | undefined {
  const kind = `git.${operation === "switch-base-and-pull" ? "switchBaseAndPull" : operation}`;
  const matches = (activity: Activity) =>
    activity.kind === kind && activity.scope?.repositoryPath === repository;
  return (
    activities.find(
      (activity) => matches(activity) && activity.status === "running",
    ) ??
    activities.find(
      (activity) => matches(activity) && activity.status === "queued",
    )
  );
}

export function remoteActionDisabled(
  repo: GitRepoSummary,
  remoteActionInProgress: boolean,
): boolean {
  return remoteActionInProgress || !repo.hasRemote;
}

export function pullDisabled(
  repo: GitRepoSummary,
  remoteActionInProgress: boolean,
): boolean {
  return (
    remoteActionDisabled(repo, remoteActionInProgress) ||
    repo.detached ||
    !repo.hasUpstream
  );
}

export function pushDisabled(
  repo: GitRepoSummary,
  remoteActionInProgress: boolean,
): boolean {
  return (
    remoteActionDisabled(repo, remoteActionInProgress) ||
    repo.detached ||
    (repo.ahead ?? 0) <= 0
  );
}

export function syncDisabled(
  repo: GitRepoSummary,
  remoteActionInProgress: boolean,
): boolean {
  return remoteActionDisabled(repo, remoteActionInProgress) || repo.detached;
}

export function basePullDisabled(
  repo: GitRepoSummary,
  remoteActionInProgress: boolean,
): boolean {
  return remoteActionDisabled(repo, remoteActionInProgress);
}

export function showPull(repo: GitRepoSummary): boolean {
  return repo.hasUpstream && !repo.detached && (repo.behind ?? 0) > 0;
}

export function showPush(repo: GitRepoSummary): boolean {
  return !repo.detached && (repo.ahead ?? 0) > 0;
}
