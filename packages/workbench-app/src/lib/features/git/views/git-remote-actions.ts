import type { GitRepoSummary } from "@nervekit/contracts/git";
import { isActivityRunning, type Activity } from "@nervekit/contracts/activity";
import type { GitRemoteOperation } from "./git-panel-types.js";

const activityKind = (operation: GitRemoteOperation) =>
  `git.${operation === "switch-base-and-pull" ? "switchBaseAndPull" : operation}`;

/** Stop the running command first, never a bulk parent or another repository's work. */
export function activeRemoteOperation(
  activities: readonly Activity[],
  repository: string,
  operation: GitRemoteOperation,
): Activity | undefined {
  const kind = activityKind(operation);
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

const REMOTE_OPERATIONS = [
  "fetch",
  "pull",
  "push",
  "sync",
  "switch-base-and-pull",
] as const satisfies readonly GitRemoteOperation[];

/** The one remote operation currently running (or queued) in a repository. */
export function runningRemoteActivity(
  activities: readonly Activity[],
  repository: string,
): Activity | undefined {
  for (const operation of REMOTE_OPERATIONS) {
    const found = activeRemoteOperation(activities, repository, operation);
    if (found) return found;
  }
  return undefined;
}

export function repositoryRemoteBusy(
  activities: readonly Activity[],
  repository: string,
): boolean {
  return Boolean(runningRemoteActivity(activities, repository));
}

const plural = (count: number) =>
  `${count} ${count === 1 ? "commit" : "commits"}`;

/** What Sync will do: the diverged counts for the button and its tooltip. */
export function syncSummary(repo: GitRepoSummary): {
  parts: string[];
  help: string;
} {
  const behind = repo.behind ?? 0;
  const ahead = repo.ahead ?? 0;
  const parts = [behind > 0 ? `↓${behind}` : "", ahead > 0 ? `↑${ahead}` : ""];
  const steps = [
    behind > 0 ? `pull ${plural(behind)}` : "",
    ahead > 0 ? `push ${plural(ahead)}` : "",
  ].filter(Boolean);
  return {
    parts: parts.filter(Boolean),
    help: steps.length
      ? `Sync: ${steps.join(", ")}`
      : "Up to date · Sync fetches remote changes",
  };
}

/** The remote operation an activity belongs to, if it is a per-repository one. */
export function remoteOperationOf(
  activity: Activity,
): GitRemoteOperation | undefined {
  return REMOTE_OPERATIONS.find(
    (operation) => activityKind(operation) === activity.kind,
  );
}

/**
 * The failed remote operation to surface for a repository: only when the most
 * recent one failed. A later success or cancel, running work, or dismissing the
 * Activity entry (which removes it) clears it.
 */
export function lastRemoteFailure(
  activities: readonly Activity[],
  repository: string,
): Activity | undefined {
  const own = activities.filter(
    (activity) =>
      activity.scope?.repositoryPath === repository &&
      remoteOperationOf(activity),
  );
  if (own.some((activity) => isActivityRunning(activity))) return undefined;
  const time = (activity: Activity) =>
    Date.parse(activity.finishedAt ?? activity.updatedAt);
  const latest = own.reduce<Activity | undefined>(
    (best, activity) =>
      !best || time(activity) >= time(best) ? activity : best,
    undefined,
  );
  return latest?.status === "failed" ? latest : undefined;
}
