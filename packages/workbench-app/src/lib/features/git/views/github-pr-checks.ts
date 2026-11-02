import type {
  GithubCheckRun,
  GithubChecksSummary,
} from "@nervekit/contracts/git";

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

/**
 * Whether any check is still running or queued. Independent of `status`,
 * where a failure outranks pending: a failing summary can still be running.
 */
export function checksRunning(
  checks: Pick<GithubChecksSummary, "pending"> | undefined,
): boolean {
  return (checks?.pending ?? 0) > 0;
}

/** One-line count breakdown for badge tooltips, e.g. "1 failing, 6 running, 5 passed". */
export function checksBreakdown(
  checks: Pick<GithubChecksSummary, "failed" | "pending" | "passed">,
): string {
  const parts: string[] = [];
  if (checks.failed > 0) parts.push(`${checks.failed} failing`);
  if (checks.pending > 0) parts.push(`${checks.pending} running`);
  if (checks.passed > 0) parts.push(`${checks.passed} passed`);
  return parts.join(", ");
}

export type CheckGroupStatus =
  | "failed"
  | "running"
  | "queued"
  | "passed"
  | "skipped";

export const CHECK_GROUP_ORDER: readonly CheckGroupStatus[] = [
  "failed",
  "running",
  "queued",
  "passed",
  "skipped",
];

/** Display bucket for one run; `status` is the lowercased state from the parser. */
export function checkRunGroup(
  run: Pick<GithubCheckRun, "status">,
): CheckGroupStatus {
  const state = run.status.toLowerCase();
  if (state === "skipped") return "skipped";
  const outcome = githubCheckRunOutcome(state);
  if (outcome === "failed") return "failed";
  if (outcome === "passed") return "passed";
  return state === "in_progress" ? "running" : "queued";
}

export type CheckSummary = {
  total: number;
  counts: Record<CheckGroupStatus, number>;
  /** Everything that is neither running nor queued. */
  complete: number;
  /** Required checks that have not passed (skipped counts as not passing). */
  requiredNotPassing: number;
  headline: string;
};

export function summarizeCheckRuns(
  runs: readonly GithubCheckRun[],
): CheckSummary {
  const counts: Record<CheckGroupStatus, number> = {
    failed: 0,
    running: 0,
    queued: 0,
    passed: 0,
    skipped: 0,
  };
  let requiredNotPassing = 0;
  for (const run of runs) {
    const group = checkRunGroup(run);
    counts[group] += 1;
    if (run.required && group !== "passed") requiredNotPassing += 1;
  }
  const waiting = counts.running + counts.queued;
  const noun = (count: number) => (count === 1 ? "check" : "checks");
  const headline =
    runs.length === 0
      ? "No checks reported"
      : counts.failed > 0
        ? `${counts.failed} ${noun(counts.failed)} failing`
        : waiting > 0
          ? `${waiting} ${noun(waiting)} running`
          : "All checks passed";
  return {
    total: runs.length,
    counts,
    complete: runs.length - waiting,
    requiredNotPassing,
    headline,
  };
}

/** Seconds a run took, or has been running; undefined when it never started. */
export function checkRunSeconds(
  run: Pick<GithubCheckRun, "startedAt" | "completedAt">,
  now = Date.now(),
): number | undefined {
  const started = run.startedAt ? Date.parse(run.startedAt) : Number.NaN;
  if (Number.isNaN(started)) return undefined;
  const completed = run.completedAt ? Date.parse(run.completedAt) : Number.NaN;
  const end = Number.isNaN(completed) ? now : completed;
  return Math.max(0, Math.round((end - started) / 1_000));
}

export function formatCheckDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
