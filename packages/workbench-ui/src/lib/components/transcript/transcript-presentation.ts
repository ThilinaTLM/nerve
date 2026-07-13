import type {
  ApprovalWithToolCall,
  PlanReviewRecord,
  UserQuestionRecord,
} from "../../state/tool-types";
import type { TimelineItem } from "../../state/timeline";

export type ActivityStackPosition = "single" | "start" | "middle" | "end";

export function toolNodeNeedsAttention(
  node: TimelineItem,
  approvals: readonly ApprovalWithToolCall[],
  pendingUserQuestion: UserQuestionRecord | undefined,
  pendingPlanReview: PlanReviewRecord | undefined,
): boolean {
  if (node.kind !== "tool") return false;
  const id = node.toolCall.id;
  return (
    (node.toolCall.status === "pending_approval" &&
      approvals.some(
        (approval) =>
          approval.toolCallId === id && approval.status === "pending",
      )) ||
    (pendingUserQuestion?.toolCallId === id &&
      pendingUserQuestion.status === "pending") ||
    (pendingPlanReview?.toolCallId === id &&
      pendingPlanReview.status === "pending")
  );
}

export function isRoutineActivityNode(
  node: TimelineItem,
  needsAttention: boolean,
): boolean {
  if (needsAttention) return false;
  if (node.kind === "tool_draft") return true;
  return (
    node.kind === "tool" &&
    node.toolCall.status !== "error" &&
    node.toolCall.status !== "denied"
  );
}

export function activityStackPositions(
  stackable: readonly boolean[],
): Array<ActivityStackPosition | undefined> {
  return stackable.map((current, index) => {
    if (!current) return undefined;
    const previous = stackable[index - 1] ?? false;
    const next = stackable[index + 1] ?? false;
    if (previous && next) return "middle";
    if (previous) return "end";
    if (next) return "start";
    return "single";
  });
}
