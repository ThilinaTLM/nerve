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

/** Whether the conversation is waiting on the user or has failed. */
export function conversationNeedsAttention(
  activity: ConversationActivity | undefined,
): boolean {
  return (
    activity?.indicator === "needs-user" || activity?.indicator === "error"
  );
}

/** Second row line; only states the user must act on explain themselves. */
export function conversationRowDetail(
  activity: ConversationActivity,
): { text: string; tone: StatusTone } | undefined {
  if (!conversationNeedsAttention(activity) || !activity.label)
    return undefined;
  return { text: activity.label, tone: activity.tone };
}
