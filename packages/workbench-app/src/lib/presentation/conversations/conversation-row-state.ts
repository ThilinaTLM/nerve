import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type { ConversationActivity } from "./conversation-activity";

/** What the leading slot of a conversation row shows. */
export type ConversationRowGlyph = "none" | "open-dot" | "activity";

/** Idle closed conversations stay quiet; idle open tabs get a small dot. */
export function conversationRowGlyph(
  activity: ConversationActivity,
  isOpen: boolean,
): ConversationRowGlyph {
  if (activity.indicator !== "idle") return "activity";
  return isOpen ? "open-dot" : "none";
}

/** Whether the conversation is waiting on the user, failed, or was interrupted. */
export function conversationNeedsAttention(
  activity: ConversationActivity | undefined,
): boolean {
  return (
    activity?.indicator === "needs-user" ||
    activity?.indicator === "error" ||
    activity?.indicator === "aborted"
  );
}

/** Second row line; only states the user must act on or read explain themselves. */
export function conversationRowDetail(
  activity: ConversationActivity,
): { text: string; tone: StatusTone } | undefined {
  if (
    !activity.statusText ||
    !(
      conversationNeedsAttention(activity) ||
      activity.indicator === "result-ready"
    )
  )
    return undefined;
  return { text: activity.statusText, tone: activity.tone };
}

/** Compact card label; full activity text remains available to assistive technology. */
export function conversationStatusLabel(
  activity: ConversationActivity,
): string | undefined {
  switch (activity.indicator) {
    case "needs-user": {
      const text = activity.statusText?.toLowerCase() ?? "";
      return text.endsWith("plan ready for review")
        ? "Plan"
        : text.endsWith("question for you")
          ? "Question"
          : "Approval";
    }
    case "error":
      return "Failed";
    case "aborted":
      return "Stopped";
    case "result-ready":
      return "Finished";
    case "running":
    case "awaiting-async":
      return "Running";
    case "completed":
      return "Done";
    default:
      return undefined;
  }
}
