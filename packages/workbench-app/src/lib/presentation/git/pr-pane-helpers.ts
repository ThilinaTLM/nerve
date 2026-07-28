import type { GithubChecksSummary } from "@nervekit/contracts";
import type { BadgeTone } from "@nervekit/ui-kit/components/ui/badge";
import { githubCheckRunOutcome } from "./github-pr-checks";
import type { PrViewState } from "./github-pr-types";

type PrDetail = NonNullable<PrViewState["detail"]>;

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

export function stateTone(detail: PrDetail | undefined): BadgeTone {
  if (!detail) return "neutral";
  if (detail.isDraft) return "neutral";
  if (detail.state === "MERGED") return "accent";
  if (detail.state === "CLOSED") return "danger";
  return "good";
}

export function stateLabel(detail: PrDetail | undefined): string {
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
