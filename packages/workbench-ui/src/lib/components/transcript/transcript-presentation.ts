import type {
  ApprovalWithToolCall,
  PlanReviewRecord,
  UserQuestionRecord,
} from "../../state/tool-types";
import type { TimelineItem } from "../../state/timeline";

export type ActivityStackPosition = "single" | "start" | "middle" | "end";

export type TimelineMessageItem = Extract<TimelineItem, { kind: "message" }>;

/** Consecutive assistant thinking messages rendered as one flat reasoning row. */
export type ThinkingGroupNode = {
  kind: "thinking_group";
  key: string;
  items: TimelineMessageItem[];
};

export type TranscriptDisplayNode = TimelineItem | ThinkingGroupNode;

function isThinkingNode(node: TimelineItem): node is TimelineMessageItem {
  return (
    node.kind === "message" &&
    node.item.role === "assistant" &&
    node.item.displayKind === "thinking"
  );
}

/**
 * Collapse consecutive assistant thinking messages into single
 * `thinking_group` nodes so a burst of reasoning renders as one flat row.
 * The group key is the first member's key, keeping row identity stable
 * as later blocks stream in and join the group.
 */
export function groupConsecutiveThinking(
  timeline: readonly TimelineItem[],
): TranscriptDisplayNode[] {
  const result: TranscriptDisplayNode[] = [];
  for (const node of timeline) {
    if (!isThinkingNode(node)) {
      result.push(node);
      continue;
    }
    const previous = result.at(-1);
    if (previous?.kind === "thinking_group") {
      previous.items.push(node);
    } else {
      result.push({ kind: "thinking_group", key: node.key, items: [node] });
    }
  }
  return result;
}

export function toolNodeNeedsAttention(
  node: TranscriptDisplayNode,
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
  node: TranscriptDisplayNode,
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
