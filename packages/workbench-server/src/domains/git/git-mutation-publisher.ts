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

type GitMutationMethod = keyof typeof mutationLabels;

const mutationLabels = {
  createBranch: "Create branch",
  switchBranch: "Switch branch",
  deleteBranch: "Delete branch",
  createWorktree: "Create worktree",
  removeWorktree: "Remove worktree",
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

export function isProjectWideMutation(method: string): boolean {
  return (
    method === "clone" ||
    method === "createWorktree" ||
    method === "removeWorktree"
  );
}

/**
 * Decorates the shared Git service at the host boundary. Failed mutations are
 * reported to Activity with sanitized text; successful ones invalidate shared
 * reads and notify the workspace store, which publishes the new revision.
 */
export function withGitMutationReporting(
  service: GitService,
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
        !Object.hasOwn(mutationLabels, property) ||
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
        if (projectId) {
          // The mutation touched one repository (clones and worktrees change the set).
          if (isProjectWideMutation(property))
            target.invalidateProjectReads(projectId);
          else target.invalidateRepoReads(projectId, repo);
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
