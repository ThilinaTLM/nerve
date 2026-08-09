import type { GitDiscoveryResponse } from "$lib/api";

export type ProjectGitOverview = {
  repositoryCount: number;
  branch?: string;
  detached: boolean;
  changeCount: number;
  aheadCount: number;
  upstreamKnown: boolean;
};

export function summarizeProjectGit(
  discovery: GitDiscoveryResponse,
): ProjectGitOverview {
  const soleRepo =
    discovery.repos.length === 1 ? discovery.repos[0] : undefined;
  return {
    repositoryCount: discovery.repos.length,
    branch: soleRepo?.currentBranch ?? undefined,
    detached: soleRepo?.detached ?? false,
    changeCount: discovery.repos.reduce(
      (total, repo) => total + repo.changeCount,
      0,
    ),
    aheadCount: discovery.repos.reduce(
      (total, repo) => total + Math.max(0, repo.ahead ?? 0),
      0,
    ),
    upstreamKnown:
      discovery.repos.length > 0 &&
      discovery.repos.every((repo) => repo.hasUpstream),
  };
}
