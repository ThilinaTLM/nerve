import type { GitMutationResponse } from "@nervekit/contracts/git";
import {
  GitService,
  currentGitCommandOptions,
  safeGitFailure,
  type GitActivityPort,
} from "@nervekit/tools/git";

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
          if (!currentGitCommandOptions().activityId) {
            try {
              activities
                ?.start({
                  kind: `git.${property}`,
                  title: `Git ${property} failed`,
                  scope: {
                    projectId:
                      typeof args[0] === "string" ? args[0] : undefined,
                    repositoryPath:
                      typeof args[1] === "string" ? args[1] : undefined,
                  },
                })
                .fail(safeGitFailure(error));
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
        return result;
      };
    },
  });
}
