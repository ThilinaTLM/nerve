import type { GithubPr, GithubPrListFilters } from "@nervekit/contracts";

export const GIT_STALE_MS = 30_000;
export const GIT_OVERVIEW_AUTO_REFRESH_COOLDOWN_MS = 3_000;
export const GIT_PR_AUTO_REFRESH_COOLDOWN_MS = 30_000;
export const GITHUB_STATUS_STALE_MS = 5 * 60_000;
export const PR_STALE_MS = 60_000;
export const PR_PENDING_POLL_MS = 10_000;

export function githubPrFiltersFingerprint(
  filters: GithubPrListFilters,
): string {
  return JSON.stringify({
    author: filters.author,
    username: filters.username ?? "",
    drafts: filters.drafts,
    title: filters.title,
    head: filters.head ?? "",
    labels: [...filters.labels].sort(),
    sort: filters.sort,
  });
}

export function isFresh(
  updatedAt: number | undefined,
  now: number,
  staleMs: number,
): boolean {
  return updatedAt !== undefined && now - updatedAt < staleMs;
}

export function pendingPollTargets(input: {
  visible: boolean;
  prs: readonly GithubPr[];
  activePrNumber?: number;
  activePrPending: boolean;
}): { pollActiveDetail: boolean; pollList: boolean } {
  if (!input.visible) return { pollActiveDetail: false, pollList: false };
  const pending = input.prs.filter((pr) => pr.checks.status === "pending");
  const pollActiveDetail = input.activePrPending;
  const listHasOtherPending = pending.some(
    (pr) => pr.number !== input.activePrNumber,
  );
  return {
    pollActiveDetail,
    pollList: listHasOtherPending || (!pollActiveDetail && pending.length > 0),
  };
}
