import type { GitContext } from "$lib/features/git/state/git-state.svelte";

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
