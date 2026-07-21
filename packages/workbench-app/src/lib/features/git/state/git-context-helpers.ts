import type { GitContext } from "$lib/core/types/state-types";

export const GIT_CONTEXT_FOCUS_STALE_MS = 30_000;
export const GIT_OVERVIEW_AUTO_REFRESH_MS = 30_000;

export function gitContextFingerprint(ctx: GitContext): string {
  return JSON.stringify({
    projectId: ctx.projectId,
    projectIsRepo: ctx.projectIsRepo,
    repos: ctx.repos.map((repo) => ({
      relativePath: repo.relativePath,
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
    })),
    github: ctx.github
      ? {
          available: ctx.github.available,
          authenticated: ctx.github.authenticated,
        }
      : undefined,
  });
}

export function shouldRefreshGitContextOnFocus(
  ctx: GitContext | undefined,
  projectId: string | undefined,
  now: number,
  staleMs: number,
): boolean {
  if (!projectId) return false;
  if (!ctx || ctx.projectId !== projectId) return true;
  return now - ctx.loadedAt >= staleMs;
}
