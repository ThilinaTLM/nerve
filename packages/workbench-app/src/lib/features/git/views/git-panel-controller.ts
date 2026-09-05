import type {
  GitBranchSummary,
  GitFileChange,
  GithubPr,
  GithubPrHeadSummary,
  GithubPrHeadsResponse,
  GitStashArea,
} from "@nervekit/contracts/git";
import type {
  GitPanelActions,
  GitPanelModel,
  GitPrFilterConfig,
  GitRemoteOperation,
} from "./git-panel-types.js";
import {
  panelTreeExpandableIds,
  type PanelTreeNode,
} from "$lib/presentation/panels/panel-tree";

export function gitFileGroups(files: readonly GitFileChange[]): {
  staged: GitFileChange[];
  unstaged: GitFileChange[];
} {
  return {
    staged: files.filter((file) => file.staged),
    unstaged: files.filter((file) => file.untracked || file.worktree !== " "),
  };
}

export function gitFilesInScope(
  files: readonly GitFileChange[],
  area: GitStashArea,
  path?: string,
): GitFileChange[] {
  const grouped = gitFileGroups(files)[area];
  if (!path) return grouped;
  return grouped.filter(
    (file) => file.path === path || file.path.startsWith(`${path}/`),
  );
}

export function gitPathspecs(files: readonly GitFileChange[]): string[] {
  return [
    ...new Set(
      files.flatMap((file) =>
        file.renamedFrom ? [file.path, file.renamedFrom] : [file.path],
      ),
    ),
  ];
}

export function gitChangeTreeFolderKey(
  area: GitStashArea,
  path: readonly string[],
): string {
  return `${area}:group:${JSON.stringify(path)}`;
}

export function gitExpandedGroupIds<T>(
  nodes: readonly PanelTreeNode<T>[],
  area: GitStashArea,
  collapsed: ReadonlySet<string>,
): Set<string> {
  return new Set(
    [...panelTreeExpandableIds(nodes)].filter(
      (id) => !collapsed.has(`${area}:${id}`),
    ),
  );
}

export type GitBranchDialogRow = {
  readonly branch: GitBranchSummary;
  readonly pullRequest?: GithubPrHeadSummary;
  readonly updatedLabel: string;
};

export type GitBranchDialogGroups = {
  readonly all: GitBranchDialogRow[];
  readonly local: GitBranchDialogRow[];
  readonly remote: GitBranchDialogRow[];
};

function branchHeadName(branch: GitBranchSummary): string {
  if (!branch.remote) return branch.name;
  const separator = branch.name.indexOf("/");
  return separator === -1 ? branch.name : branch.name.slice(separator + 1);
}

function branchTimestamp(branch: GitBranchSummary): number {
  if (!branch.updatedAt) return Number.NEGATIVE_INFINITY;
  const timestamp = Date.parse(branch.updatedAt);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

export function formatBranchUpdatedLabel(
  updatedAt: string | null,
  now = Date.now(),
): string {
  if (!updatedAt) return "Update time unavailable";
  const timestamp = Date.parse(updatedAt);
  if (Number.isNaN(timestamp)) return "Update time unavailable";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (seconds < 60) return "Updated just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `Updated ${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Updated ${months}mo ago`;
  return `Updated ${Math.floor(months / 12)}y ago`;
}

export function groupBranchesForDialog(
  branches: readonly GitBranchSummary[],
  filter: string,
  baseBranch?: string,
  prHeads?: GithubPrHeadsResponse,
  now = Date.now(),
): GitBranchDialogGroups {
  const eligiblePrs = new Map<string, GithubPrHeadSummary>();
  if (prHeads) {
    const repository = prHeads.repository.toLocaleLowerCase();
    for (const pr of prHeads.prs) {
      if (pr.headRepository?.toLocaleLowerCase() !== repository) continue;
      if (!eligiblePrs.has(pr.headRefName)) eligiblePrs.set(pr.headRefName, pr);
    }
  }
  const query = filter.trim().toLocaleLowerCase();
  const rows = branches
    .map((branch): GitBranchDialogRow => {
      const pullRequest = eligiblePrs.get(branchHeadName(branch));
      return {
        branch,
        ...(pullRequest ? { pullRequest } : {}),
        updatedLabel: formatBranchUpdatedLabel(branch.updatedAt, now),
      };
    })
    .filter(({ branch, pullRequest }) => {
      if (!query) return true;
      return [
        branch.name,
        branch.upstream ?? "",
        pullRequest ? `#${pullRequest.number}` : "",
      ].some((value) => value.toLocaleLowerCase().includes(query));
    });
  const compare = (left: GitBranchDialogRow, right: GitBranchDialogRow) => {
    if (left.branch.current !== right.branch.current)
      return left.branch.current ? -1 : 1;
    const leftBase =
      !left.branch.remote &&
      baseBranch !== undefined &&
      left.branch.name === baseBranch;
    const rightBase =
      !right.branch.remote &&
      baseBranch !== undefined &&
      right.branch.name === baseBranch;
    if (leftBase !== rightBase) return leftBase ? -1 : 1;
    const recency =
      branchTimestamp(right.branch) - branchTimestamp(left.branch);
    return recency || left.branch.name.localeCompare(right.branch.name);
  };
  return {
    all: [...rows].sort(compare),
    local: rows.filter(({ branch }) => !branch.remote).sort(compare),
    remote: rows.filter(({ branch }) => branch.remote).sort(compare),
  };
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

export type GitPrFilterDraft = Omit<GitPrFilterConfig, "labels"> & {
  labels: string;
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

export function createGitPrFilterDraft(
  filters: GitPrFilterConfig,
): GitPrFilterDraft {
  const normalized = normalizeGitPrFilterConfig(filters);
  return {
    ...normalized,
    labels: normalized.labels.join(", "),
  };
}

export function applyGitPrFilterDraft(
  draft: GitPrFilterDraft,
  hasCurrentBranch: boolean,
): GitPrFilterConfig {
  return normalizeGitPrFilterConfig({
    ...draft,
    currentBranchOnly: hasCurrentBranch && draft.currentBranchOnly,
    labels: draft.labels.split(","),
  });
}

export function gitPrFilterConfigsEqual(
  left: GitPrFilterConfig,
  right: GitPrFilterConfig,
): boolean {
  const normalizedLeft = normalizeGitPrFilterConfig(left);
  const normalizedRight = normalizeGitPrFilterConfig(right);
  return (
    normalizedLeft.author === normalizedRight.author &&
    normalizedLeft.username === normalizedRight.username &&
    normalizedLeft.drafts === normalizedRight.drafts &&
    normalizedLeft.title === normalizedRight.title &&
    normalizedLeft.currentBranchOnly === normalizedRight.currentBranchOnly &&
    normalizedLeft.sort === normalizedRight.sort &&
    normalizedLeft.labels.length === normalizedRight.labels.length &&
    normalizedLeft.labels.every(
      (label, index) => label === normalizedRight.labels[index],
    )
  );
}

export function activeGitPrFilterCount(filters: GitPrFilterConfig): number {
  const normalized = normalizeGitPrFilterConfig(filters);
  return (
    Number(normalized.author !== defaultGitPrFilterConfig.author) +
    Number(normalized.drafts !== defaultGitPrFilterConfig.drafts) +
    Number(normalized.title.length > 0) +
    Number(normalized.currentBranchOnly) +
    normalized.labels.length +
    Number(normalized.sort !== defaultGitPrFilterConfig.sort)
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
    refreshPrHeads: (repository) => {
      if (available() && model().capabilities.refresh.enabled)
        return host.refreshPrHeads(repository);
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
    deleteBranch: (repository, branch) => {
      if (available() && model().capabilities.branches.enabled)
        return host.deleteBranch(repository, branch);
      return false;
    },
    openDiff: (repository, file, area) => {
      if (available()) return host.openDiff(repository, file, area);
    },
    mutateFile: (repository, file, action) => {
      if (available() && model().capabilities.mutateFiles.enabled)
        return host.mutateFile(repository, file, action);
    },
    mutateFileScope: (repository, area, action, path) => {
      if (available() && model().capabilities.bulkMutateFiles.enabled)
        return host.mutateFileScope(repository, area, action, path);
    },
    createStash: (repository, area, path) => {
      if (available() && model().capabilities.stashes.enabled)
        return host.createStash(repository, area, path);
    },
    setChangeTreeFolderExpanded: (repository, key, expanded) => {
      if (available())
        return host.setChangeTreeFolderExpanded(repository, key, expanded);
    },
    applyStash: (repository, stash) => {
      if (available() && model().capabilities.stashes.enabled)
        return host.applyStash(repository, stash);
    },
    dropStash: (repository, stash) => {
      if (available() && model().capabilities.stashes.enabled)
        return host.dropStash(repository, stash);
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
