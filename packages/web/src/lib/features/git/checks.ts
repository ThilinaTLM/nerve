import type { GithubChecksSummary, GithubPr } from "@nerve/shared";

export function isGithubChecksPending(
  checks: Pick<GithubChecksSummary, "status"> | undefined,
): boolean {
  return checks?.status === "pending";
}

export function hasPendingPrChecks(
  prs: Array<Pick<GithubPr, "checks">>,
): boolean {
  return prs.some((pr) => isGithubChecksPending(pr.checks));
}
