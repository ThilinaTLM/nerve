import type { GitMutationResponse } from "@nervekit/contracts";
import { GitService } from "@nervekit/tools";

const mutationReasons = {
  createBranch: "branch.created",
  switchBranch: "branch.switched",
  stageFile: "file.staged",
  unstageFile: "file.unstaged",
  discardFile: "file.discarded",
  syncBranch: "branch.synced",
  switchBaseAndPull: "base.updated",
  push: "remote.pushed",
  pull: "remote.pulled",
  fetch: "remote.fetched",
  checkoutPr: "github.pr.checked_out",
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
): GitService {
  return new Proxy(service, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (
        typeof property !== "string" ||
        !(property in mutationReasons) ||
        typeof value !== "function"
      ) {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (...args: unknown[]) => {
        const result = (await value.apply(target, args)) as GitMutationResponse;
        const projectId = typeof args[0] === "string" ? args[0] : undefined;
        const repo =
          typeof args[1] === "string"
            ? args[1]
            : result.repo.relativePath || ".";
        await events.publish("git.repository.changed", {
          projectId:
            projectId && projectId.startsWith("proj_") ? projectId : undefined,
          repo,
          reason: mutationReasons[property as GitMutationMethod],
          head: result.repo.currentBranch
            ? { branch: result.repo.currentBranch }
            : undefined,
        });
        return result;
      };
    },
  });
}
