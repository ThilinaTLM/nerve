import type {
  GitBranchSummary,
  GitFileChange,
  GithubPr,
} from "@nervekit/contracts";
import type {
  GitPanelActions,
  GitPanelModel,
  GitRemoteOperation,
} from "./git-panel-types.js";

export function gitFileGroups(files: readonly GitFileChange[]): {
  staged: GitFileChange[];
  unstaged: GitFileChange[];
} {
  return {
    staged: files.filter((file) => file.staged),
    unstaged: files.filter((file) => file.untracked || file.worktree !== " "),
  };
}

export function filterAndSortBranches(
  branches: readonly GitBranchSummary[],
  filter: string,
): GitBranchSummary[] {
  const query = filter.trim().toLocaleLowerCase();
  return branches
    .filter((branch) => branch.name.toLocaleLowerCase().includes(query))
    .sort((left, right) => {
      if (left.current !== right.current) return left.current ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
}

export function sortPullRequests(
  pullRequests: readonly GithubPr[],
  currentBranch: string | null,
): GithubPr[] {
  return [...pullRequests].sort((left, right) => {
    const leftCurrent =
      currentBranch !== null && left.headRefName === currentBranch;
    const rightCurrent =
      currentBranch !== null && right.headRefName === currentBranch;
    if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}

/**
 * Wrap host effects with the normalized feature capabilities. Views can call
 * every action without optional callbacks; unsupported actions remain inert.
 */
export function createGitPanelActions(
  model: () => GitPanelModel,
  host: GitPanelActions,
): GitPanelActions {
  const available = () => model().availability.available;
  const enabled = (operation: GitRemoteOperation) =>
    available() && model().capabilities.remote[operation].enabled;

  return {
    refreshAll: () => {
      if (available() && model().capabilities.refresh.enabled)
        return host.refreshAll();
    },
    refreshRepository: (repository) => {
      if (available() && model().capabilities.refresh.enabled)
        return host.refreshRepository(repository);
    },
    refreshBranches: (repository) => {
      if (available() && model().capabilities.refresh.enabled)
        return host.refreshBranches(repository);
    },
    refreshPullRequests: (repository) => {
      if (available() && model().capabilities.refresh.enabled)
        return host.refreshPullRequests(repository);
    },
    selectRepository: (repository) => {
      if (available() && model().capabilities.selectRepository.enabled)
        return host.selectRepository(repository);
    },
    createBranch: (repository, name) => {
      if (available() && model().capabilities.branches.enabled)
        return host.createBranch(repository, name);
      return false;
    },
    switchBranch: (repository, branch) => {
      if (available() && model().capabilities.branches.enabled)
        return host.switchBranch(repository, branch);
      return false;
    },
    mutateFile: (repository, file, action) => {
      if (available() && model().capabilities.mutateFiles.enabled)
        return host.mutateFile(repository, file, action);
    },
    bulkMutateFiles: (repository, action) => {
      if (available() && model().capabilities.bulkMutateFiles.enabled)
        return host.bulkMutateFiles(repository, action);
    },
    runRemoteOperation: (repository, operation) => {
      if (enabled(operation))
        return host.runRemoteOperation(repository, operation);
    },
    selectPullRequest: (number) => {
      if (available()) return host.selectPullRequest(number);
    },
    openPullRequest: (repository, number) => {
      if (available() && model().capabilities.openPullRequest.enabled)
        return host.openPullRequest(repository, number);
    },
  };
}
