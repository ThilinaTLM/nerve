import type { GitBranchSummary, GithubStatusResponse } from "$lib/api";

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
