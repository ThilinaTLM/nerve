import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ConversationEntry,
  ConversationTreeNode,
  ToolCallTranscriptRecord,
} from "$lib/api";
import {
  buildHistoryGraph,
  classifyHistoryEntry,
  parseToolCallNames,
} from "./history-graph";

function entry(
  id: string,
  overrides: Partial<ConversationEntry> = {},
): ConversationEntry {
  return {
    id: `entry_${id}`,
    conversationId: "conv_01H00000000000000000000000",
    role: "user",
    kind: "message",
    text: "",
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

describe("buildHistoryGraph", () => {
  it("keeps a linear history in lane 0", () => {
    const nodes = [
      node("a", undefined, ["b"]),
      node("b", "a", ["c"]),
      node("c", "b", []),
    ];
    const graph = buildHistoryGraph(nodes, "entry_c");
    assert.equal(graph.laneCount, 1);
    assert.deepEqual(
      graph.rows.map((row) => row.lane),
      [0, 0, 0],
    );
    assert.deepEqual(
      graph.rows.map((row) => row.isOnActivePath),
      [true, true, true],
    );
    assert.equal(graph.rows.at(-1)?.isLeaf, true);
  });

  it("allocates a new lane at a branch point", () => {
    // a -> b -> c (branch A), and a -> b -> d (branch B)
    const nodes = [
      node("a", undefined, ["b"]),
      node("b", "a", ["c", "d"]),
      node("c", "b", []),
      node("d", "b", []),
    ];
    const graph = buildHistoryGraph(nodes, "entry_d");
    assert.equal(graph.laneCount, 2);
    const byId = new Map(graph.rows.map((row) => [row.node.entry.id, row]));
    assert.equal(byId.get("entry_b")?.isBranchPoint, true);
    // First child reuses parent lane; second child gets a fresh lane.
    assert.equal(byId.get("entry_c")?.lane, 0);
    assert.equal(byId.get("entry_d")?.lane, 1);
    assert.equal(byId.get("entry_d")?.parentLane, 0);
    // Active path is a -> b -> d only.
    assert.equal(byId.get("entry_c")?.isOnActivePath, false);
    assert.equal(byId.get("entry_d")?.isOnActivePath, true);
    assert.equal(byId.get("entry_a")?.isOnActivePath, true);
  });

  it("treats entries with missing parents as roots", () => {
    const nodes = [node("orphan", "missing", [])];
    const graph = buildHistoryGraph(nodes, undefined);
    assert.equal(graph.rows.length, 1);
    assert.equal(graph.rows[0]?.lane, 0);
  });
});

describe("classifyHistoryEntry", () => {
  const noTools = new Map<string, ToolCallTranscriptRecord>();

  it("classifies a user message", () => {
    const d = classifyHistoryEntry(
      entry("u", { role: "user", text: "hi" }),
      noTools,
    );
    assert.equal(d.type, "user");
    assert.equal(d.label, "You");
  });

  it("classifies an assistant text message", () => {
    const d = classifyHistoryEntry(
      entry("a", { role: "assistant", text: "Sure thing." }),
      noTools,
    );
    assert.equal(d.type, "assistant");
  });

  it("adds a thinking badge when thinking blocks are present", () => {
    const d = classifyHistoryEntry(
      entry("a", {
        role: "assistant",
        text: "Done.",
        details: { thinkingBlocks: [{ text: "reasoning" }] },
      }),
      noTools,
    );
    assert.equal(d.type, "assistant");
    assert.equal(d.badges.length, 1);
  });

  it("parses new names-only and historical argument-bearing placeholders", () => {
    assert.deepEqual(parseToolCallNames("[Tool call: read(), ask_user()]"), [
      "read",
      "ask_user",
    ]);
    assert.deepEqual(
      parseToolCallNames('[Tool call: bash({"command":"ls"})]'),
      ["bash"],
    );
  });

  it("classifies a names-only tool call placeholder", () => {
    const d = classifyHistoryEntry(
      entry("a", {
        role: "assistant",
        text: "[Tool call: write()]",
      }),
      noTools,
    );
    assert.equal(d.type, "tool_call");
    assert.equal(d.label, "write");
  });

  it("flags names-only interaction tool calls as human-in-the-loop", () => {
    const d = classifyHistoryEntry(
      entry("a", {
        role: "assistant",
        text: "[Tool call: ask_user()]",
      }),
      noTools,
    );
    assert.equal(d.type, "human_loop");
    assert.ok(d.badges.some((badge) => badge.label === "input"));
  });

  it("classifies a tool result and surfaces errors", () => {
    const d = classifyHistoryEntry(
      entry("r", {
        role: "system",
        text: "boom",
        details: { toolName: "bash", isError: true },
      }),
      noTools,
    );
    assert.equal(d.type, "tool_result");
    assert.equal(d.tone, "danger");
    assert.ok(d.badges.some((badge) => badge.label === "error"));
  });

  it("flags approval-gated tool results via the tool record", () => {
    const tools = new Map<string, ToolCallTranscriptRecord>([
      [
        "tool_1",
        {
          id: "tool_1",
          agentId: "agent_01H00000000000000000000000",
          conversationId: "conv_01H00000000000000000000000",
          projectId: "proj_01H0000000000000000000000",
          toolName: "write",
          risk: "workspace_write",
          args: {},
          cwd: "/tmp",
          status: "completed",
          approvalId: "approval_1",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        } as ToolCallTranscriptRecord,
      ],
    ]);
    const d = classifyHistoryEntry(
      entry("r", {
        role: "system",
        text: "wrote file",
        details: { toolName: "write", toolRecordId: "tool_1" },
      }),
      tools,
    );
    assert.equal(d.type, "human_loop");
    assert.ok(d.badges.some((badge) => badge.label === "human"));
  });

  it("classifies compaction and branch summaries", () => {
    assert.equal(
      classifyHistoryEntry(entry("c", { kind: "compaction" }), noTools).type,
      "compaction",
    );
    assert.equal(
      classifyHistoryEntry(entry("c", { kind: "branch_summary" }), noTools)
        .type,
      "branch_summary",
    );
  });
});
