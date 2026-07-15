import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ConversationEntry,
  ConversationTreeNode,
  ToolCallTranscriptRecord,
} from "$lib/api";
import { buildHistoryEntryView } from "./history-entry-view";
import {
  buildHistoryFlow,
  HISTORY_ROOT_NODE_ID,
  historyEntryNodeId,
  historySegmentNodeId,
  historyZoomTier,
} from "./history-flow";
import { buildHistoryGraph } from "./history-graph";
import { buildHistoryVisible } from "./history-segments";

const noTools = new Map<string, ToolCallTranscriptRecord>();

function entry(
  id: string,
  overrides: Partial<ConversationEntry> = {},
): ConversationEntry {
  return {
    id: `entry_${id}`,
    conversationId: "conv_01H00000000000000000000000",
    role: "user",
    kind: "message",
    text: id,
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

function flowFor(
  nodes: ConversationTreeNode[],
  activeEntryId?: string,
  expanded = new Set<string>(),
) {
  const graph = buildHistoryGraph(nodes, activeEntryId);
  const visible = buildHistoryVisible(graph.rows, noTools, expanded);
  const entryViewById = new Map(
    nodes.map(({ entry }) => [entry.id, buildHistoryEntryView(entry, noTools)]),
  );
  return {
    flow: buildHistoryFlow({
      visible,
      hasConversation: true,
      rootActive: !activeEntryId,
      rootOnActivePath: true,
      selectedKey: activeEntryId ? `e:${activeEntryId}` : "root",
      entryViewById,
    }),
    visible,
  };
}

describe("buildHistoryFlow", () => {
  it("connects a linear history downward from the synthetic root", () => {
    const { flow } = flowFor(
      [node("a", undefined, ["b"]), node("b", "a", [])],
      "entry_b",
    );
    assert.deepEqual(
      flow.edges.map(({ source, target }) => [source, target]),
      [
        [HISTORY_ROOT_NODE_ID, historyEntryNodeId("entry_a")],
        [historyEntryNodeId("entry_a"), historyEntryNodeId("entry_b")],
      ],
    );
    const byId = new Map(flow.nodes.map((value) => [value.id, value]));
    assert.ok(
      byId.get(historyEntryNodeId("entry_a"))!.position.y <
        byId.get(historyEntryNodeId("entry_b"))!.position.y,
    );
  });

  it("spreads sibling branches horizontally at the same rank", () => {
    const { flow } = flowFor([
      node("a", undefined, ["b", "c"]),
      node("b", "a", []),
      node("c", "a", []),
    ]);
    const byId = new Map(flow.nodes.map((value) => [value.id, value]));
    const b = byId.get(historyEntryNodeId("entry_b"))!;
    const c = byId.get(historyEntryNodeId("entry_c"))!;
    assert.equal(b.position.y, c.position.y);
    assert.notEqual(b.position.x, c.position.x);
  });

  it("routes through collapsed segments without self-edges", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const nodes = ids.map((id, index) =>
      node(
        id,
        index === 0 ? undefined : ids[index - 1],
        index === ids.length - 1 ? [] : [ids[index + 1]],
        {
          role: "assistant",
          text: "[Tool call: bash()]",
        },
      ),
    );
    const { flow, visible } = flowFor(nodes, "entry_f");
    const segment = visible.segments[0];
    const segmentId = historySegmentNodeId(segment.id);
    assert.deepEqual(
      flow.edges.map(({ source, target }) => [source, target]),
      [
        [HISTORY_ROOT_NODE_ID, segmentId],
        [segmentId, historyEntryNodeId("entry_f")],
      ],
    );
    assert.ok(flow.edges.every((edge) => edge.source !== edge.target));
    assert.equal(flow.visibleNodeIdByEntryId.get("entry_c"), segmentId);
  });

  it("connects detached roots to the synthetic root", () => {
    const { flow } = flowFor([node("orphan", "missing", [])]);
    assert.deepEqual(
      flow.edges.map(({ source, target }) => [source, target]),
      [[HISTORY_ROOT_NODE_ID, historyEntryNodeId("entry_orphan")]],
    );
  });

  it("marks active ancestry edges and stable selected node ids", () => {
    const { flow } = flowFor(
      [
        node("a", undefined, ["b", "c"]),
        node("b", "a", []),
        node("c", "a", []),
      ],
      "entry_c",
    );
    const edgeToB = flow.edges.find(
      (edge) => edge.target === historyEntryNodeId("entry_b"),
    );
    const edgeToC = flow.edges.find(
      (edge) => edge.target === historyEntryNodeId("entry_c"),
    );
    assert.equal(edgeToB?.data?.isOnActivePath, false);
    assert.equal(edgeToC?.data?.isOnActivePath, true);
    assert.equal(
      flow.nodes.find((value) => value.selected)?.id,
      historyEntryNodeId("entry_c"),
    );
  });
});

describe("historyZoomTier", () => {
  it("maps zoom levels to stable semantic tiers", () => {
    assert.equal(historyZoomTier(0.2), "overview");
    assert.equal(historyZoomTier(0.4), "summary");
    assert.equal(historyZoomTier(0.85), "detail");
  });
});
