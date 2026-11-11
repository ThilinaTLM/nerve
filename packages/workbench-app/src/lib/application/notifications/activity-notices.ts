import type { ActivityNoticeInput } from "$lib/application/activity/activity-controller";

export type NoticeKind = "success" | "error" | "warning" | "message";

export type ActivityNoticeSink = (notice: ActivityNoticeInput) => void;

let sink: ActivityNoticeSink | undefined;

/** The Activity inbox registers itself while it runs; no sink means no-op. */
export function setActivityNoticeSink(next: ActivityNoticeSink | undefined) {
  sink = next;
}

/**
 * Failures, warnings and refusals always belong in Activity so they stay
 * visible where no toast is shown (desktop). Successes and plain messages are
 * recorded only when the caller marks them as significant.
 */
export function activityNoticeFor(
  kind: NoticeKind,
  title: string,
  options: { description?: string; tag?: string; activity?: boolean } = {},
): ActivityNoticeInput | undefined {
  const record = options.activity ?? (kind === "error" || kind === "warning");
  if (!record) return undefined;
  return {
    // Repeating the same feedback replaces the earlier notice.
    key: options.tag ?? `notify:${title}`,
    title,
    status: kind === "error" || kind === "warning" ? "failed" : "succeeded",
    message: options.description,
  };
}

export function recordActivityNotice(
  kind: NoticeKind,
  title: string,
  options: { description?: string; tag?: string; activity?: boolean } = {},
): void {
  if (!sink) return;
  const notice = activityNoticeFor(kind, title, options);
  if (notice) sink(notice);
}
