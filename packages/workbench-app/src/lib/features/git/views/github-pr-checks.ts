import type { GithubChecksSummary, GithubPr } from "@nervekit/contracts/git";

export type GithubCheckRunOutcome = "passed" | "failed" | "pending";

const PASSED_STATES = new Set(["success", "neutral", "skipped", "completed"]);
const FAILED_STATES = new Set([
  "failure",
  "error",
  "cancelled",
  "timed_out",
  "action_required",
]);

/** Buckets a single check run state (already lowercased by the parser). */
export function githubCheckRunOutcome(status: string): GithubCheckRunOutcome {
  const state = status.toLowerCase();
  if (PASSED_STATES.has(state)) return "passed";
  if (FAILED_STATES.has(state)) return "failed";
  return "pending";
}

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
