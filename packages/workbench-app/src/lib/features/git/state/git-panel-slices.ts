import type {
  GitBranchSummary,
  GithubPr,
  GithubStatusResponse,
  GitOverviewResponse,
  GitRecentCommit,
  GitRepoSummary,
} from "$lib/api";

export type GitChangesState = Pick<
  GitOverviewResponse,
  | "files"
  | "stagedCount"
  | "unstagedCount"
  | "untrackedCount"
  | "insertions"
  | "deletions"
>;

export function repoSummaryFingerprint(repo: GitRepoSummary): string {
  return JSON.stringify({
    relativePath: repo.relativePath,
    absDir: repo.absDir,
    name: repo.name,
    currentBranch: repo.currentBranch,
    detached: repo.detached,
    ahead: repo.ahead,
    behind: repo.behind,
    hasUpstream: repo.hasUpstream,
    hasRemote: repo.hasRemote,
    hasGithubRemote: repo.hasGithubRemote,
    baseBranch: repo.baseBranch,
    onBaseBranch: repo.onBaseBranch,
    mergedToBase: repo.mergedToBase,
    dirty: repo.dirty,
    changeCount: repo.changeCount,
  });
}

export function changesFromOverview(
  next: GitOverviewResponse,
): GitChangesState {
  return {
    files: next.files,
    stagedCount: next.stagedCount,
    unstagedCount: next.unstagedCount,
    untrackedCount: next.untrackedCount,
    insertions: next.insertions,
    deletions: next.deletions,
  };
}

export function changesFingerprint(changes: GitChangesState): string {
  return JSON.stringify({
    counts: {
      staged: changes.stagedCount,
      unstaged: changes.unstagedCount,
      untracked: changes.untrackedCount,
      insertions: changes.insertions,
      deletions: changes.deletions,
    },
    files: changes.files.map((file) => ({
      path: file.path,
      renamedFrom: file.renamedFrom,
      index: file.index,
      worktree: file.worktree,
      staged: file.staged,
      untracked: file.untracked,
    })),
  });
}

export function recentCommitsFingerprint(commits: GitRecentCommit[]): string {
  return JSON.stringify(
    commits.map((commit) => ({
      hash: commit.hash,
      subject: commit.subject,
      relativeDate: commit.relativeDate,
    })),
  );
}

export function branchesFingerprint(branches: GitBranchSummary[]): string {
  return JSON.stringify(
    branches.map((branch) => ({
      name: branch.name,
      current: branch.current,
      remote: branch.remote,
      upstream: branch.upstream,
    })),
  );
}

export function githubStatusFingerprint(
  github: GithubStatusResponse | undefined,
): string | undefined {
  if (!github) return undefined;
  return JSON.stringify({
    available: github.available,
    authenticated: github.authenticated,
    login: github.login,
    reason: github.reason,
  });
}

export function prsFingerprint(prs: GithubPr[]): string {
  return JSON.stringify(prs);
}

export function reposFingerprint(repos: GitRepoSummary[]): string {
  return JSON.stringify(repos.map((repo) => repoSummaryFingerprint(repo)));
}

export function overviewFingerprint(next: GitOverviewResponse): string {
  return JSON.stringify({
    repo: repoSummaryFingerprint(next.repo),
    changes: changesFingerprint(changesFromOverview(next)),
    recentCommits: recentCommitsFingerprint(next.recentCommits),
  });
}
