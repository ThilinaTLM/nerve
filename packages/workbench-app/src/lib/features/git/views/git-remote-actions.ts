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

/** The single remote button a repository row shows, chosen from its state. */
export type PrimaryRemoteAction = {
  operation: Extract<GitRemoteOperation, "sync" | "pull" | "push">;
  /** Count badges next to the icon; arrows only when the icon shows both ways. */
  parts: string[];
  label: string;
  help: string;
};

export function primaryRemoteAction(repo: GitRepoSummary): PrimaryRemoteAction {
  if (!repo.detached && repo.currentBranch && !repo.hasUpstream) {
    const count = repo.unpublishedCount ?? 0;
    return {
      operation: "push",
      parts: count > 0 ? [`${count}`] : [],
      label: "Publish branch",
      help: `Publish ${repo.currentBranch} to origin${count > 0 ? ` (${plural(count)})` : ""}`,
    };
  }
  const behind = repo.behind ?? 0;
  const ahead = repo.ahead ?? 0;
  if (behind > 0 && ahead === 0)
    return {
      operation: "pull",
      parts: [`${behind}`],
      label: "Pull",
      help: `Pull ${plural(behind)}`,
    };
  if (ahead > 0 && behind === 0)
    return {
      operation: "push",
      parts: [`${ahead}`],
      label: "Push",
      help: `Push ${plural(ahead)}`,
    };
  if (ahead > 0 && behind > 0)
    return {
      operation: "sync",
      parts: [`↓${behind}`, `↑${ahead}`],
      label: "Sync",
      help: `Sync: pull ${plural(behind)}, push ${plural(ahead)}`,
    };
  return {
    operation: "sync",
    parts: [],
    label: "Sync",
    help: "Up to date · Sync fetches remote changes",
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
