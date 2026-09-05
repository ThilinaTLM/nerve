import { prSummaryFingerprint } from "./pr-sync";
import type {
  GitBranchSummary,
  GithubPr,
  GithubPrHeadsResponse,
  GithubStatusResponse,
  GitOverviewResponse,
  GitRecentCommit,
  GitRepoSummary,
  GitStashEntry,
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

export function stashesFingerprint(stashes: readonly GitStashEntry[]): string {
  return JSON.stringify(
    stashes.map((stash) => ({
      index: stash.index,
      ref: stash.ref,
      hash: stash.hash,
      message: stash.message,
      relativeDate: stash.relativeDate,
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
      updatedAt: branch.updatedAt,
    })),
  );
}

export function prHeadsFingerprint(
  result: GithubPrHeadsResponse | undefined,
): string | undefined {
  if (!result) return undefined;
  return JSON.stringify(result);
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
  return prs.map(prSummaryFingerprint).join("\n");
}

export function reposFingerprint(repos: GitRepoSummary[]): string {
  return JSON.stringify(repos.map((repo) => repoSummaryFingerprint(repo)));
}

export function overviewFingerprint(next: GitOverviewResponse): string {
  return JSON.stringify({
    repo: repoSummaryFingerprint(next.repo),
    changes: changesFingerprint(changesFromOverview(next)),
    recentCommits: recentCommitsFingerprint(next.recentCommits),
    stashes: stashesFingerprint(next.stashes),
  });
}
