import type { GithubChecksSummary, GithubPr, GithubPrCore } from "$lib/api";

export function prSummaryFromCore(
  core: GithubPrCore,
  checks: GithubChecksSummary,
): GithubPr {
  return {
    number: core.number,
    title: core.title,
    url: core.url,
    state: core.state,
    isDraft: core.isDraft,
    headRefName: core.headRefName,
    baseRefName: core.baseRefName,
    updatedAt: core.updatedAt,
    checks,
  };
}

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
