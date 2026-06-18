import type { GithubChecksSummary } from "$lib/api";
import type { BadgeTone } from "$lib/components/ui/badge";
import type { PrViewState } from "$lib/core/types/state-types";

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
  const s = status.toLowerCase();
  if (["success", "neutral", "skipped", "completed"].includes(s)) return "good";
  if (
    ["failure", "error", "cancelled", "timed_out", "action_required"].includes(
      s,
    )
  )
    return "danger";
  return "warn";
}

export function formatPrDate(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}
