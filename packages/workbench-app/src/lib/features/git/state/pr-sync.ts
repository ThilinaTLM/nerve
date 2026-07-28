import type { GithubChecksSummary, GithubPr, GithubPrDetail } from "$lib/api";

/**
 * Pure projection helpers that keep the Git panel PR list and the open PR
 * detail tabs in sync. `GithubPrDetail` extends `GithubPr`, so a list row is
 * always derivable from a freshly loaded detail.
 */

export function prSummaryFromDetail(detail: GithubPrDetail): GithubPr {
  return {
    number: detail.number,
    title: detail.title,
    url: detail.url,
    state: detail.state,
    isDraft: detail.isDraft,
    headRefName: detail.headRefName,
    baseRefName: detail.baseRefName,
    updatedAt: detail.updatedAt,
    checks: detail.checks,
  };
}

/**
 * The list (`statusCheckRollup`) and detail (`gh pr checks`) sources report the
 * same runs in different orders, so compare them order-independently to avoid
 * spurious "changed" results.
 */
function checksFingerprint(checks: GithubChecksSummary): string {
  return [
    checks.status,
    checks.total,
    checks.passed,
    checks.failed,
    checks.pending,
    checks.runs
      .map((run) => `${run.name}:${run.status}`)
      .sort()
      .join("|"),
  ].join(",");
}

export function prSummaryFingerprint(pr: GithubPr): string {
  return [
    pr.number,
    pr.title,
    pr.url,
    pr.state,
    pr.isDraft,
    pr.headRefName,
    pr.baseRefName,
    pr.updatedAt,
    checksFingerprint(pr.checks),
  ].join("\u0000");
}

export function prSummariesEqual(left: GithubPr, right: GithubPr): boolean {
  return prSummaryFingerprint(left) === prSummaryFingerprint(right);
}
