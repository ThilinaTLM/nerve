import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ConversationEntry,
  ConversationTreeNode,
  ToolCallTranscriptRecord,
} from "$lib/api";
import { buildHistoryGraph } from "./history-graph";
import {
  buildHistoryVisible,
  defaultExpandedSegments,
} from "./history-segments";

const noTools = new Map<string, ToolCallTranscriptRecord>();

function entry(
  id: string,
  overrides: Partial<ConversationEntry> = {},
): ConversationEntry {
  return {
    id: `entry_${id}`,
    conversationId: "conv_01H00000000000000000000000",
    role: "assistant",
    kind: "message",
    text: '[Tool call: bash({"command":"ls"})]',
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function node(
  id: string,
  parent: string | undefined,
  children: string[],
  overrides: Partial<ConversationEntry> = {},
): ConversationTreeNode {
  return {
    entry: entry(id, {
      parentEntryId: parent ? `entry_${parent}` : undefined,
      ...overrides,
    }),
    childEntryIds: children.map((child) => `entry_${child}`),
  };
}

/** A long linear chain of tool-call entries a..h ending at a leaf. */
function linearToolChain(ids: string[]): ConversationTreeNode[] {
  return ids.map((id, i) =>
    node(
      id,
      i === 0 ? undefined : ids[i - 1],
      i === ids.length - 1 ? [] : [ids[i + 1]],
    ),
  );
}

describe("buildHistoryVisible", () => {
  it("folds a long linear noise run into one segment", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const graph = buildHistoryGraph(linearToolChain(ids), `entry_f`);
    const visible = buildHistoryVisible(graph.rows, noTools, new Set());
    // The active entry (leaf f) is never collapsed; a..e middle minus the
    // leaf forms the run. Head a has no parent (root) but is still collapsible.
    assert.equal(visible.segments.length, 1);
    const segment = visible.segments[0];
    assert.equal(segment.id, "entry_a");
    assert.equal(segment.total, 5); // a..e
    // Items: one segment + the leaf entry.
    assert.equal(visible.items.length, 2);
    assert.equal(visible.items[0]?.type, "segment");
    assert.equal(visible.items[1]?.type, "entry");
    // Interior members resolve to the segment's visible index (0).
    assert.equal(visible.visibleIndexById.get("entry_c"), 0);
    assert.equal(visible.visibleIndexById.get("entry_f"), 1);
  });

  it("expands a segment when its id is in the expanded set", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const graph = buildHistoryGraph(linearToolChain(ids), `entry_f`);
    const collapsed = buildHistoryVisible(graph.rows, noTools, new Set());
    const expanded = buildHistoryVisible(
      graph.rows,
      noTools,
      new Set([collapsed.segments[0].id]),
    );
    // 5 folded entries + leaf = 6 visible rows, no collapsed segment items.
    assert.equal(expanded.items.length, 6);
    assert.ok(expanded.items.every((item) => item.type === "entry"));
    assert.equal(expanded.visibleIndexById.get("entry_c"), 2);
  });

  it("never folds user or human-loop entries", () => {
    const nodes = [
      node("u", undefined, ["a"], { role: "user", text: "hi" }),
      node("a", "u", ["b"]),
      node("b", "a", ["q"]),
      node("q", "b", ["c"], {
        text: '[Tool call: ask_user({"question":"ok?"})]',
      }),
      node("c", "q", ["d"]),
      node("d", "c", []),
    ];
    const graph = buildHistoryGraph(nodes, "entry_d");
    const visible = buildHistoryVisible(graph.rows, noTools, new Set());
    // The human-loop turn `q` splits the chain, so no run reaches length 3.
    assert.equal(visible.segments.length, 0);
    const user = visible.items.find(
      (item) => item.type === "entry" && item.row.node.entry.id === "entry_u",
    );
    assert.ok(user, "user message stays visible");
  });

  it("does not collapse runs shorter than the minimum", () => {
    const ids = ["a", "b", "c"]; // a,b collapsible; c is the leaf
    const graph = buildHistoryGraph(linearToolChain(ids), "entry_c");
    const visible = buildHistoryVisible(graph.rows, noTools, new Set());
    assert.equal(visible.segments.length, 0);
    assert.equal(visible.items.length, 3);
  });

  it("auto-expands segments on the active branch by default", () => {
    // Branch at b: active path a -> b -> (long run) -> leaf; off-path sibling.
    const nodes = [
      node("a", undefined, ["b"]),
      node("b", "a", ["c", "x"]),
      // active long run c..g
      node("c", "b", ["d"]),
      node("d", "c", ["e"]),
      node("e", "d", ["f"]),
      node("f", "e", ["g"]),
      node("g", "f", []),
      // off-path sibling run x..z
      node("x", "b", ["y"]),
      node("y", "x", ["z"]),
      node("z", "y", ["w"]),
      node("w", "z", []),
    ];
    const graph = buildHistoryGraph(nodes, "entry_g");
    const collapsed = buildHistoryVisible(graph.rows, noTools, new Set());
    assert.ok(
      collapsed.segments.length >= 2,
      "both runs are segment candidates",
    );
    const expanded = defaultExpandedSegments(collapsed.segments);
    const activeSegment = collapsed.segments.find((s) => s.isOnActivePath);
    const offSegment = collapsed.segments.find((s) => !s.isOnActivePath);
    assert.ok(activeSegment && expanded.has(activeSegment.id));
    assert.ok(offSegment && !expanded.has(offSegment.id));
  });
});
