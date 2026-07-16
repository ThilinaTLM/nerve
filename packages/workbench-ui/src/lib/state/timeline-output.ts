import type { TimelineItem } from "./timeline.js";

/**
 * Whether the rendered timeline already contains non-user output from a run.
 *
 * Run ownership, rather than transient/live state, keeps this true while a
 * streamed node is replaced by its durable entry. That prevents pre-output UI
 * from reappearing during materialization handoffs.
 */
export function hasRunTimelineOutput(
  timeline: TimelineItem[],
  runId: string | undefined,
): boolean {
  if (!runId) return false;

  // Current-run output normally sits at the tail, so scan newest-first to keep
  // token-by-token projections cheap even for long transcripts.
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item.kind === "message") {
      if (item.item.role !== "user" && item.item.runId === runId) return true;
      continue;
    }
    if (item.kind === "tool") {
      if (item.draft?.runId === runId || item.toolCall?.runId === runId) {
        return true;
      }
      continue;
    }
    if (item.kind === "tool_result_error") {
      if (item.runId === runId) return true;
      continue;
    }
    if (item.notice.runId === runId) return true;
  }
  return false;
}
