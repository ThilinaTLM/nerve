import { GitService } from "@nervekit/tools/git";
import type { GitRepositoryWatcher } from "./git-repository-watcher.js";

/** Registers repositories for native invalidation before reading an overview. */
export function withGitRepositoryWatching(
  service: GitService,
  watcher: Pick<GitRepositoryWatcher, "watch">,
): GitService {
  return new Proxy(service, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (property !== "overview" || typeof value !== "function") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (projectId: string, repo: string) => {
        watcher.watch(projectId, repo, target.resolveRepoDir(projectId, repo));
        return target.overview(projectId, repo);
      };
    },
  });
}
