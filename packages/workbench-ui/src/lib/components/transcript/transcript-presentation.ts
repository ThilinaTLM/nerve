import type { TimelineItem } from "../../state/timeline";

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
