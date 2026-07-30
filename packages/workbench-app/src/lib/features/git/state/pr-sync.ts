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

export function checksFingerprint(checks: GithubChecksSummary): string {
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

export function prChecksEqual(
  left: GithubChecksSummary | undefined,
  right: GithubChecksSummary,
): boolean {
  return (
    left !== undefined && checksFingerprint(left) === checksFingerprint(right)
  );
}

export function prCoreMatchesSummary(
  core: GithubPrCore,
  summary: GithubPr,
): boolean {
  return (
    core.number === summary.number &&
    core.title === summary.title &&
    core.url === summary.url &&
    core.state === summary.state &&
    core.isDraft === summary.isDraft &&
    core.headRefName === summary.headRefName &&
    core.baseRefName === summary.baseRefName &&
    core.updatedAt === summary.updatedAt
  );
}
