import type {
  GithubChecksSummary,
  GithubPrComment,
  GithubPrConversation,
  GithubPrCore,
  GithubPrFileStatus,
  GithubPrMergeMethod,
  GithubPrOverview,
  GithubPrReviewSummary,
} from "@nervekit/contracts";
import type { BadgeTone } from "@nervekit/ui-kit/components/ui/badge";
import { githubCheckRunOutcome } from "./github-pr-checks";

type TimelineEntry =
  | { kind: "comment"; at: string; value: GithubPrComment }
  | { kind: "review"; at: string; value: GithubPrReviewSummary };

export type MergeReadiness = {
  status: "ready" | "blocked" | "unknown";
  reasons: string[];
  /** Admins may merge even when branch-protection requirements block the PR. */
  canOverride: boolean;
};

export function checksTone(checks: GithubChecksSummary): BadgeTone {
  switch (checks.status) {
    case "passing":
      return "good";
    case "failing":
      return "danger";
    case "pending":
      return "warn";
    default:
      return "neutral";
  }
}

type PrStateSummary = Pick<GithubPrCore, "isDraft" | "state">;

export function stateTone(detail: PrStateSummary | undefined): BadgeTone {
  if (!detail) return "neutral";
  if (detail.isDraft) return "neutral";
  if (detail.state === "MERGED") return "accent";
  if (detail.state === "CLOSED") return "danger";
  return "good";
}

export function stateLabel(detail: PrStateSummary | undefined): string {
  if (!detail) return "";
  if (detail.isDraft) return "draft";
  return detail.state.toLowerCase();
}

export function reviewTone(decision: string): BadgeTone {
  if (decision === "APPROVED") return "good";
  if (decision === "CHANGES_REQUESTED") return "danger";
  return "warn";
}

export function runTone(status: string): BadgeTone {
  const outcome = githubCheckRunOutcome(status);
  if (outcome === "passed") return "good";
  if (outcome === "failed") return "danger";
  return "warn";
}

export function formatPrDate(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

export function formatRelativePrDate(value?: string, now = Date.now()): string {
  if (!value) return "";
  const date = new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) return "";
  const seconds = Math.round((now - time) / 1000);
  if (seconds < 45) return "just now";
  if (seconds < 90) return "1m ago";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === new Date(now).getFullYear()
        ? undefined
        : "numeric",
  });
}

export function reviewSurfaceClass(state: string): string {
  if (state === "APPROVED") return "bg-success/8";
  if (state === "CHANGES_REQUESTED") return "bg-destructive/8";
  return "";
}

const COLLAPSED_BODY_LINES = 14;

export function bodyLineCount(body: string): number {
  return body.split("\n").length;
}

export function shouldCollapseBody(body: string): boolean {
  return bodyLineCount(body) > COLLAPSED_BODY_LINES;
}

const CHECK_RUN_SORT_ORDER = { failed: 0, pending: 1, passed: 2 } as const;

export function sortCheckRuns<T extends { name: string; status: string }>(
  runs: T[],
): T[] {
  return [...runs].sort((left, right) => {
    const leftRank =
      CHECK_RUN_SORT_ORDER[
        githubCheckRunOutcome(left.status) as keyof typeof CHECK_RUN_SORT_ORDER
      ] ?? 3;
    const rightRank =
      CHECK_RUN_SORT_ORDER[
        githubCheckRunOutcome(right.status) as keyof typeof CHECK_RUN_SORT_ORDER
      ] ?? 3;
    return leftRank !== rightRank
      ? leftRank - rightRank
      : left.name.localeCompare(right.name);
  });
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

export function mergeReadiness(
  detail: GithubPrCore & GithubPrOverview & { checks: GithubChecksSummary },
): MergeReadiness {
  if (detail.state !== "OPEN") {
    return {
      status: "blocked",
      reasons: ["Pull request is not open"],
      canOverride: false,
    };
  }
  if (detail.isDraft) {
    return {
      status: "blocked",
      reasons: ["Pull request is still a draft"],
      canOverride: false,
    };
  }
  const canOverride =
    (detail.viewerPermission === "ADMIN" ||
      detail.viewerPermission === "MAINTAIN") &&
    detail.mergeable === "MERGEABLE" &&
    detail.mergeSettings.allowedMethods.length > 0;
  if (
    !detail.headRefOid ||
    detail.mergeable === null ||
    detail.mergeable === "UNKNOWN"
  ) {
    return {
      status: "unknown",
      reasons: ["GitHub is calculating mergeability"],
      canOverride: false,
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
  return reasons.length > 0
    ? { status: "blocked", reasons: [...new Set(reasons)], canOverride }
    : { status: "ready", reasons: [], canOverride };
}

export function divergenceLabel(detail: GithubPrOverview): string {
  if (detail.behindBy === null) {
    return detail.mergeStateStatus === "BEHIND"
      ? "Base branch has updates"
      : "Base branch status unavailable";
  }
  if (detail.behindBy === 0) return "Up to date with base";
  return `${detail.behindBy} ${detail.behindBy === 1 ? "commit" : "commits"} behind base`;
}

export function divergenceTone(detail: GithubPrOverview): BadgeTone {
  if (detail.behindBy === null) return "neutral";
  return detail.behindBy > 0 ? "warn" : "good";
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
