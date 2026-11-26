import type {
  ConfigurationReview,
  ConfigurationReviewItem,
} from "@nervekit/contracts/configuration";

/** Splits text at `backtick` spans, so the daemon's sentences render with inline code and never as HTML. */
export function codeSpans(text: string): { text: string; code: boolean }[] {
  return text
    .split(/(`[^`]+`)/)
    .filter((part) => part !== "")
    .map((part) =>
      part.length > 2 && part.startsWith("`") && part.endsWith("`")
        ? { text: part.slice(1, -1), code: true }
        : { text: part, code: false },
    );
}

/** "Sub-agent profile · User". */
export function reviewKindLine(
  review: Pick<ConfigurationReview, "kindLabel" | "target">,
): string {
  return `${review.kindLabel} · ${review.target.scope === "user" ? "User" : "Project"}`;
}

/** Broad items first, then new ones; otherwise the daemon's order. */
export function orderedReviewItems(
  items: readonly ConfigurationReviewItem[],
): ConfigurationReviewItem[] {
  const rank = (item: ConfigurationReviewItem) =>
    (item.broad ? 0 : 2) + (item.new ? 0 : 1);
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .map(({ item }) => item);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "2 min ago", "3 h ago", "4 d ago", else the date. */
export function timeAgo(iso: string, now: number): string | undefined {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return undefined;
  const age = Math.max(0, now - at);
  if (age < MINUTE) return "just now";
  if (age < HOUR) return `${Math.floor(age / MINUTE)} min ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)} h ago`;
  if (age < 30 * DAY) return `${Math.floor(age / DAY)} d ago`;
  return new Date(at).toLocaleDateString();
}

/**
 * Who changed it, for an item that waits: "Changed outside Nerve's settings ·
 * 2 min ago", or "Added …" when it was never decided. Nothing once decided and
 * unchanged.
 */
export function reviewChangeLine(
  review: Pick<
    ConfigurationReview,
    "state" | "changedSinceDecision" | "changedAt"
  >,
  now: number,
): string | undefined {
  const pending = review.state === "needs_review";
  if (!pending && !review.changedSinceDecision) return undefined;
  const verb = review.changedSinceDecision ? "Changed" : "Added";
  const when = review.changedAt ? timeAgo(review.changedAt, now) : undefined;
  return `${verb} outside Nerve's settings${when ? ` · ${when}` : ""}`;
}
