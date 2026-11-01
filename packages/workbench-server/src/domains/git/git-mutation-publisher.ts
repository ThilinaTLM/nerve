import type { GitMutationResponse } from "@nervekit/contracts/git";
import {
  GitService,
  currentGitCommandOptions,
  safeGitFailure,
  type GitActivityPort,
} from "@nervekit/tools/git";

const reportedFailureActivities = new WeakMap<object, string>();

export function gitMutationFailureActivityId(
  error: unknown,
): string | undefined {
  return error !== null && typeof error === "object"
    ? reportedFailureActivities.get(error)
    : undefined;
}

const mutationReasons = {
  createBranch: "branch.created",
  switchBranch: "branch.switched",
  deleteBranch: "branch.deleted",
  stageFile: "file.staged",
  unstageFile: "file.unstaged",
  discardFile: "file.discarded",
  syncBranch: "branch.synced",
  switchBaseAndPull: "base.updated",
  push: "remote.pushed",
  pull: "remote.pulled",
  fetch: "remote.fetched",
  createStash: "stash.created",
  applyStash: "stash.applied",
  dropStash: "stash.dropped",
  checkoutPr: "github.pr.checked_out",
  clone: "repository.cloned",
  mergePr: "github.pr.merged",
} as const;

type GitMutationMethod = keyof typeof mutationReasons;

const mutationLabels: Record<GitMutationMethod, string> = {
  createBranch: "Create branch",
  switchBranch: "Switch branch",
  deleteBranch: "Delete branch",
  stageFile: "Stage file",
  unstageFile: "Unstage file",
  discardFile: "Discard changes",
  syncBranch: "Sync branch",
  switchBaseAndPull: "Switch to base and pull",
  push: "Push",
  pull: "Pull",
  fetch: "Fetch",
  createStash: "Create stash",
  applyStash: "Apply stash",
  dropStash: "Drop stash",
  checkoutPr: "Check out pull request",
  clone: "Clone repository",
  mergePr: "Merge pull request",
};

export interface GitRepositoryChangedData {
  readonly projectId?: string;
  readonly repo: string;
  readonly reason: (typeof mutationReasons)[GitMutationMethod];
  readonly head?: { readonly branch?: string };
}

export interface GitMutationEventPublisher {
  publish(
    type: "git.repository.changed",
    data: GitRepositoryChangedData,
  ): unknown | Promise<unknown>;
}

/**
 * Decorates the shared Git service at the host boundary. Mutations publish only
 * after Git has succeeded; publication data is repo-relative and never includes
 * remotes, credentials, command output, or environment values.
 */
export function withGitMutationEvents(
  service: GitService,
  events: GitMutationEventPublisher,
  activities?: GitActivityPort,
  onMutation?: (
    method: string,
    projectId: string,
    repo: string,
    branch?: string,
    number?: number,
  ) => void,
): GitService {
  return new Proxy(service, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (
        typeof property !== "string" ||
        !Object.hasOwn(mutationReasons, property) ||
        typeof value !== "function"
      ) {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (...args: unknown[]) => {
        let result: GitMutationResponse;
        try {
          result = (await value.apply(target, args)) as GitMutationResponse;
        } catch (error) {
          const errorObject =
            error !== null && typeof error === "object" ? error : undefined;
          // Errors may be reused; only this attempt's successful report counts.
          if (errorObject) reportedFailureActivities.delete(errorObject);
          if (!currentGitCommandOptions().activityId) {
            try {
              const activity = activities?.start({
                kind: `git.${property}`,
                title: `${mutationLabels[property as GitMutationMethod]} failed`,
                scope: {
                  projectId: typeof args[0] === "string" ? args[0] : undefined,
                  repositoryPath:
                    typeof args[1] === "string" ? args[1] : undefined,
                },
              });
              if (activity) {
                activity.fail(safeGitFailure(error));
                if (errorObject) {
                  reportedFailureActivities.set(errorObject, activity.id);
                }
              }
            } catch {
              /* Reporting must preserve the original mutation error. */
            }
          }
          throw error;
        }
        const projectId = typeof args[0] === "string" ? args[0] : undefined;
        const repo =
          typeof args[1] === "string"
            ? args[1]
            : result.repo?.relativePath || ".";
        if (projectId) target.invalidateProjectReads(projectId);
        try {
          await events.publish("git.repository.changed", {
            projectId:
              projectId && projectId.startsWith("proj_")
                ? projectId
                : undefined,
            repo,
            reason: mutationReasons[property as GitMutationMethod],
            head: result.repo?.currentBranch
              ? { branch: result.repo.currentBranch }
              : undefined,
          });
        } catch {
          /* A publication failure cannot turn a successful mutation into a failure. */
        }
        if (projectId) {
          try {
            onMutation?.(
              property,
              projectId,
              repo,
              result.repo?.currentBranch ?? undefined,
              typeof args[2] === "number" ? args[2] : undefined,
            );
          } catch {
            /* Signals are best effort. */
          }
        }
        return result;
      };
    },
  });
}
