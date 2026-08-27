import type { GitRepoSummary } from "@nervekit/contracts";

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
