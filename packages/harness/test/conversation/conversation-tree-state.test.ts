import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildConversationContext,
  ConversationTreeState,
  type ConversationTreeEntry,
} from "../../src/conversation/index.js";

const now = "2026-08-26T00:00:00.000Z";

function message(id: string, parentId: string | null): ConversationTreeEntry {
  return {
    type: "custom_message",
    id,
    parentId,
    timestamp: now,
    customType: "test",
    content: id,
    display: true,
  };
}

describe("ConversationTreeState", () => {
  it("builds post-compaction context from only retained branch entries", () => {
    const tree = new ConversationTreeState();
    tree.append({
      type: "thinking_level_change",
      id: "thinking",
      parentId: null,
      timestamp: now,
      thinkingLevel: "high",
    });
    let parentId = "thinking";
    for (let index = 0; index < 100; index += 1) {
      const id = `old_${index}`;
      tree.append(message(id, parentId));
      parentId = id;
    }
    tree.append({
      type: "compaction",
      id: "compact",
      parentId,
      timestamp: now,
      summary: "summary",
      firstKeptEntryId: "old_95",
      tokensBefore: 10_000,
    });
    parentId = "compact";
    for (let index = 0; index < 3; index += 1) {
      const id = `new_${index}`;
      tree.append(message(id, parentId));
      parentId = id;
    }

    const fullPath = tree.getPathToRoot(tree.leafId);
    const contextPath = tree.getContextPath();
    assert.equal(fullPath.length, 105);
    assert.equal(contextPath.length, 9);
    assert.deepEqual(tree.buildContext(), buildConversationContext(fullPath));
    assert.equal(tree.buildContext().thinkingLevel, "high");
  });

  it("uses indexed lookup, labels, and branch traversal", () => {
    const tree = new ConversationTreeState();
    tree.append(message("root", null));
    tree.append(message("child", "root"));
    tree.append({
      type: "label",
      id: "label",
      parentId: "child",
      timestamp: now,
      targetId: "root",
      label: "Root",
    });

    assert.equal(tree.getEntry("child")?.parentId, "root");
    assert.equal(tree.getLabel("root"), "Root");
    assert.deepEqual(
      tree.getPathToRoot("child").map((entry) => entry.id),
      ["root", "child"],
    );
  });
});
