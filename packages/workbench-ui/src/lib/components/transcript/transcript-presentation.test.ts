import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { TimelineItem } from "../../state/timeline";
import type { ApprovalWithToolCall } from "../../state/tool-types";
import {
  groupConsecutiveThinking,
  toolNodeNeedsAttention,
} from "./transcript-presentation";

function thinkingNode(key: string, text: string, live = false): TimelineItem {
  return {
    kind: "message",
    key,
    item: {
      id: key,
      role: "assistant",
      displayKind: "thinking",
      text,
      live,
      done: !live,
    },
  };
}

function messageNode(key: string, text: string): TimelineItem {
  return {
    kind: "message",
    key,
    item: { id: key, role: "assistant", displayKind: "message", text },
  };
}

describe("transcript presentation", () => {
  it("identifies tool calls that need attention", () => {
    const attentionTool = {
      kind: "tool",
      key: "tool_1",
      toolCall: {
        id: "tool_1",
        status: "pending_approval",
      },
    } as TimelineItem;
    const approval = {
      id: "approval_1",
      toolCallId: "tool_1",
      status: "pending",
    } as ApprovalWithToolCall;
    assert.equal(
      toolNodeNeedsAttention(attentionTool, [approval], undefined, undefined),
      true,
    );
  });

  it("groups consecutive thinking messages into one display node", () => {
    const toolNode = { kind: "tool", key: "tool_1" } as TimelineItem;
    const grouped = groupConsecutiveThinking([
      thinkingNode("t1", "first"),
      thinkingNode("t2", "second"),
      messageNode("m1", "answer"),
      thinkingNode("t3", "third"),
      toolNode,
      thinkingNode("t4", "fourth", true),
    ]);

    assert.deepEqual(
      grouped.map((node) => node.kind),
      ["thinking_group", "message", "thinking_group", "tool", "thinking_group"],
    );
    const first = grouped[0];
    assert.equal(first?.kind, "thinking_group");
    if (first?.kind === "thinking_group") {
      // Key stays pinned to the first member so the row identity is stable
      // while later blocks stream in and join the group.
      assert.equal(first.key, "t1");
      assert.deepEqual(
        first.items.map((member) => member.item.text),
        ["first", "second"],
      );
    }
  });

  it("keeps user and system thinking-free rows ungrouped", () => {
    const userNode: TimelineItem = {
      kind: "message",
      key: "u1",
      item: { id: "u1", role: "user", displayKind: "message", text: "hi" },
    };
    const grouped = groupConsecutiveThinking([userNode]);
    assert.deepEqual(grouped, [userNode]);
  });
});
