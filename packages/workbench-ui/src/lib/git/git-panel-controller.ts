import type {
  GitBranchSummary,
  GitFileChange,
  GithubPr,
} from "@nervekit/contracts";
import type {
  GitPanelActions,
  GitPanelModel,
  GitPrFilterConfig,
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
  baseBranch?: string,
): GitBranchSummary[] {
  const query = filter.trim().toLocaleLowerCase();
  return branches
    .filter((branch) => branch.name.toLocaleLowerCase().includes(query))
    .sort((left, right) => {
      if (left.current !== right.current) return left.current ? -1 : 1;
      const leftBase = baseBranch !== undefined && left.name === baseBranch;
      const rightBase = baseBranch !== undefined && right.name === baseBranch;
      if (leftBase !== rightBase) return leftBase ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
}

export const defaultGitPrFilterConfig: GitPrFilterConfig = {
  author: "any",
  username: "",
  drafts: "include",
  title: "",
  currentBranchOnly: false,
  labels: [],
  sort: "updated-desc",
};

export function normalizeGitPrFilterConfig(
  filters: GitPrFilterConfig,
): GitPrFilterConfig {
  const labels = [...new Set(filters.labels.map((label) => label.trim()))]
    .filter(Boolean)
    .slice(0, 20);
  return {
    author: filters.author,
    username: filters.username.trim(),
    drafts: filters.drafts,
    title: filters.title.trim(),
    currentBranchOnly: filters.currentBranchOnly,
    labels,
    sort: filters.sort,
  };
}

export function activeGitPrFilterCount(filters: GitPrFilterConfig): number {
  const normalized = normalizeGitPrFilterConfig(filters);
  return (
    Number(normalized.author !== defaultGitPrFilterConfig.author) +
    Number(normalized.drafts !== defaultGitPrFilterConfig.drafts) +
    Number(normalized.title.length > 0) +
    Number(normalized.currentBranchOnly) +
    normalized.labels.length
  );
}

export function hasActiveGitPrFilters(filters: GitPrFilterConfig): boolean {
  const normalized = normalizeGitPrFilterConfig(filters);
  return (
    normalized.author !== defaultGitPrFilterConfig.author ||
    normalized.drafts !== defaultGitPrFilterConfig.drafts ||
    normalized.title !== defaultGitPrFilterConfig.title ||
    normalized.currentBranchOnly ||
    normalized.labels.length > 0 ||
    normalized.sort !== defaultGitPrFilterConfig.sort
  );
}

export function limitPullRequests(
  pullRequests: readonly GithubPr[],
): GithubPr[] {
  return pullRequests.slice(0, 10);
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
    configurePullRequests: (repository, filters) => {
      if (available() && model().capabilities.refresh.enabled)
        return host.configurePullRequests(repository, filters);
    },
    resetPullRequestConfig: (repository) => {
      if (available() && model().capabilities.refresh.enabled)
        return host.resetPullRequestConfig(repository);
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
