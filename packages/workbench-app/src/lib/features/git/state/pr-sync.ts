import type { GithubChecksSummary, GithubPr, GithubPrCore } from "$lib/api";

export function prSummaryFromCore(
  core: GithubPrCore,
  checks: GithubChecksSummary,
): GithubPr {
  return {
    number: core.number,
    headSha: core.headRefOid,
    headRepository: core.headRepository ?? null,
    labels: [],
    reviewRequested: false,
    title: core.title,
    url: core.url,
    state: core.state,
    isDraft: core.isDraft,
    headRefName: core.headRefName,
    baseRefName: core.baseRefName,
    updatedAt: core.updatedAt,
    author: core.author,
    commentCount: core.commentCount,
    additions: core.additions,
    deletions: core.deletions,
    checks,
  };
}
