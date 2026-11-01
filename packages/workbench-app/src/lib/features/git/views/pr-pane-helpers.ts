import type {
  GithubChecksSummary,
  GithubPrComment,
  GithubPrConversation,
  GithubPrCore,
  GithubPrFileStatus,
  GithubPrMergeMethod,
  GithubPrOverview,
  GithubPrReviewSummary,
} from "@nervekit/contracts/git";
import type { StatusTone } from "@nervekit/ui-kit/display/status";

type TimelineEntry =
  | { kind: "comment"; at: string; value: GithubPrComment }
  | { kind: "review"; at: string; value: GithubPrReviewSummary };

export type MergeReadiness = {
  status: "ready" | "blocked" | "unknown";
  reasons: string[];
  /** The viewer may merge anyway because GitHub lets them bypass every
   * remaining blocker (rules, reviews, checks, an outdated branch). */
  bypassable: boolean;
};

/** Requirements GitHub lets permitted users bypass; conflicts, drafts and
 * disabled merge methods are never bypassable. */
const BYPASSABLE_REASONS = new Set([
  "Update the branch with the latest base changes",
  "Branch protection requirements are not satisfied",
  "Checks are still running",
  "Required checks are failing",
  "Changes were requested",
  "An approving review is required",
]);

export function checksTone(checks: GithubChecksSummary): StatusTone {
  switch (checks.status) {
    case "passing":
      return "success";
    case "failing":
      return "destructive";
    case "pending":
      return "warning";
    default:
      return "neutral";
  }
}

type PrStateSummary = Pick<GithubPrCore, "isDraft" | "state">;

export function stateTone(detail: PrStateSummary | undefined): StatusTone {
  if (!detail) return "neutral";
  if (detail.isDraft) return "neutral";
  /* Merged is an outcome, not an error or a success to act on: it reads as
   * informational everywhere it appears (badge, row icon, status card). */
  if (detail.state === "MERGED") return "info";
  if (detail.state === "CLOSED") return "destructive";
  return "success";
}

export function formatPrDateCompact(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

/** Compact age for dense rows: "3m", "2h", "6d", "4mo", "2y". */
export function formatCompactAge(value?: string, now = Date.now()): string {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

export function defaultMergeMethod(
  methods: readonly GithubPrMergeMethod[],
): GithubPrMergeMethod | undefined {
  return (["merge", "squash", "rebase"] as const).find((method) =>
    methods.includes(method),
  );
}

export function mergeMethodLabel(method: GithubPrMergeMethod): string {
  if (method === "merge") return "Create a merge commit";
  if (method === "squash") return "Squash and merge";
  return "Rebase and merge";
}

export type MergeReadinessInput = Pick<
  GithubPrCore,
  "state" | "isDraft" | "headRefOid"
> &
  Pick<
    GithubPrOverview,
    | "mergeable"
    | "mergeStateStatus"
    | "reviewDecision"
    | "viewerCanMergeAsAdmin"
    | "mergeSettings"
  > & { checks: Pick<GithubChecksSummary, "status"> };

export function mergeReadiness(detail: MergeReadinessInput): MergeReadiness {
  if (detail.state !== "OPEN") {
    return {
      status: "blocked",
      reasons: ["Pull request is not open"],
      bypassable: false,
    };
  }
  if (detail.isDraft) {
    return {
      status: "blocked",
      reasons: ["Pull request is still a draft"],
      bypassable: false,
    };
  }
  if (
    !detail.headRefOid ||
    detail.mergeable === null ||
    detail.mergeable === "UNKNOWN"
  ) {
    return {
      status: "unknown",
      reasons: ["GitHub is calculating mergeability"],
      bypassable: false,
    };
  }

  const reasons: string[] = [];
  if (detail.mergeable === "CONFLICTING")
    reasons.push("Resolve merge conflicts");
  if (detail.mergeStateStatus === "BEHIND")
    reasons.push("Update the branch with the latest base changes");
  if (detail.mergeStateStatus === "BLOCKED")
    reasons.push("Branch protection requirements are not satisfied");
  if (detail.mergeStateStatus === "DIRTY")
    reasons.push("Resolve merge conflicts");
  if (detail.checks.status === "pending")
    reasons.push("Checks are still running");
  if (detail.checks.status === "failing")
    reasons.push("Required checks are failing");
  if (detail.reviewDecision === "CHANGES_REQUESTED")
    reasons.push("Changes were requested");
  if (detail.reviewDecision === "REVIEW_REQUIRED")
    reasons.push("An approving review is required");
  if (detail.mergeSettings.allowedMethods.length === 0)
    reasons.push("No merge method is enabled");
  if (reasons.length === 0)
    return { status: "ready", reasons: [], bypassable: false };
  return {
    status: "blocked",
    reasons: [...new Set(reasons)],
    bypassable:
      detail.viewerCanMergeAsAdmin &&
      reasons.every((reason) => BYPASSABLE_REASONS.has(reason)),
  };
}

export function prTimeline(detail: GithubPrConversation): TimelineEntry[] {
  return [
    ...detail.comments.map(
      (value): TimelineEntry => ({
        kind: "comment",
        at: value.createdAt,
        value,
      }),
    ),
    ...detail.reviews.map(
      (value): TimelineEntry => ({
        kind: "review",
        at: value.submittedAt,
        value,
      }),
    ),
  ].sort((left, right) => left.at.localeCompare(right.at));
}

export function fileStatusLetter(status: GithubPrFileStatus): string {
  if (status === "added") return "A";
  if (status === "removed") return "D";
  if (status === "renamed") return "R";
  if (status === "copied") return "C";
  return "M";
}

export function fileStatusTone(status: GithubPrFileStatus): string {
  if (status === "added") return "text-success";
  if (status === "removed") return "text-destructive";
  if (status === "renamed" || status === "copied") return "text-info";
  return "text-warning";
}

/** "now", "5m ago", "2h ago", "3d ago"; older than a month falls back to a date. */
export function formatRelativeAge(value?: string, now = Date.now()): string {
  const compact = formatCompactAge(value, now);
  if (!compact) return "";
  if (compact === "now") return "just now";
  if (compact.endsWith("mo") || compact.endsWith("y"))
    return new Date(value as string).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  return `${compact} ago`;
}

/** "Today", "Yesterday", or a calendar date, in the viewer's time zone. */
export function formatDayGroup(value?: string, now = Date.now()): string {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(timestamp)) return "Unknown date";
  const startOfDay = (time: number) => {
    const date = new Date(time);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  const days = Math.round(
    (startOfDay(now) - startOfDay(timestamp)) / 86_400_000,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function groupCommitsByDay<T extends { authoredDate?: string }>(
  commits: readonly T[],
  now = Date.now(),
): { day: string; commits: T[] }[] {
  const groups: { day: string; commits: T[] }[] = [];
  for (const commit of commits) {
    const day = formatDayGroup(commit.authoredDate, now);
    const last = groups.at(-1);
    if (last?.day === day) last.commits.push(commit);
    else groups.push({ day, commits: [commit] });
  }
  return groups;
}

/**
 * How the merge control should read. `ready` is the only enabled state;
 * `waiting` is transient (checks running, GitHub still computing), and
 * `blocked` needs someone to act.
 */
export type MergeAvailability =
  | { kind: "ready" }
  | { kind: "waiting" | "blocked"; reason: string; bypassable: boolean };

const WAITING_REASONS = new Set([
  "Checks are still running",
  "GitHub is calculating mergeability",
]);

export function mergeAvailability(
  readiness: MergeReadiness,
): MergeAvailability {
  if (readiness.status === "ready") return { kind: "ready" };
  const reason = readiness.reasons.join(" · ");
  return {
    kind: readiness.reasons.every((item) => WAITING_REASONS.has(item))
      ? "waiting"
      : "blocked",
    reason,
    bypassable: readiness.bypassable,
  };
}

export type PrReviewerState =
  | "approved"
  | "changes"
  | "commented"
  | "requested";

export type PrReviewer = { login: string; state: PrReviewerState };

const REVIEW_STATES: Record<string, PrReviewerState | undefined> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes",
  COMMENTED: "commented",
};

/** Latest submitted review per author, then reviewers still awaited. */
export function prReviewers(
  conversation: Pick<GithubPrConversation, "reviews"> | undefined,
  overview: Pick<GithubPrOverview, "reviewRequests"> | undefined,
  author?: string | null,
): PrReviewer[] {
  const latest = new Map<string, PrReviewerState>();
  const reviews = [...(conversation?.reviews ?? [])].sort((a, b) =>
    a.submittedAt.localeCompare(b.submittedAt),
  );
  for (const review of reviews) {
    const state = REVIEW_STATES[review.state];
    if (!review.author || !state || review.author === author) continue;
    // A bare comment never overrides an approval or a change request.
    if (state === "commented" && latest.has(review.author)) continue;
    latest.set(review.author, state);
  }
  const requested = (overview?.reviewRequests ?? []).filter(
    (reviewer) => !latest.has(reviewer.login),
  );
  return [
    ...[...latest].map(([login, state]) => ({ login, state })),
    ...requested.map(
      (reviewer): PrReviewer => ({ login: reviewer.login, state: "requested" }),
    ),
  ];
}
