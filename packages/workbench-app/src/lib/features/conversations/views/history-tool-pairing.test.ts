import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ConversationEntry,
  ConversationTreeNode,
  ToolCallTranscriptRecord,
} from "$lib/api";
import { buildHistoryEntryView } from "./history-entry-view";
import { buildHistoryFlow } from "./history-flow";
import { buildHistoryGraph } from "./history-graph";
import { buildHistoryVisible } from "./history-segments";

const createdAt = "2026-08-24T00:00:00.000Z";

function entry(
  id: string,
  role: ConversationEntry["role"],
  parentEntryId: string | undefined,
  details?: unknown,
): ConversationEntry {
  return {
    id: `entry_${id}`,
    conversationId: "conv_test",
    parentEntryId: parentEntryId ? `entry_${parentEntryId}` : undefined,
    role,
    kind: "message",
    text:
      role === "assistant"
        ? "[Tool call: bash()]"
        : role === "system"
          ? "command output"
          : "message",
    details,
    createdAt,
  };
}

function toolRecord(
  id = "tool_pair",
  providerToolCallId = "provider_pair",
): ToolCallTranscriptRecord {
  return {
    id,
    agentId: "agent_test",
    conversationId: "conv_test",
    projectId: "proj_test",
    toolName: "bash",
    providerToolCallId,
    risk: "command",
    cwd: "/tmp",
    status: "completed",
    revision: 1,
    attempt: 1,
    interactions: [],
    argsPreview: { command: "echo hi" },
    resultPreview: "command output",
    createdAt,
    updatedAt: "2026-08-24T00:00:01.000Z",
    settledAt: "2026-08-24T00:00:01.000Z",
  } as ToolCallTranscriptRecord;
}

function tree(
  requestDetails: unknown = {
    toolRecordId: "tool_pair",
    toolCallId: "provider_pair",
  },
  resultDetails: unknown = {
    toolRecordId: "tool_pair",
    toolCallId: "provider_pair",
    toolName: "bash",
  },
): ConversationTreeNode[] {
  return [
    {
      entry: entry("user", "user", undefined),
      childEntryIds: ["entry_request"],
    },
    {
      entry: entry("request", "assistant", "user", requestDetails),
      childEntryIds: ["entry_result"],
    },
    {
      entry: entry("result", "system", "request", resultDetails),
      childEntryIds: ["entry_after"],
    },
    { entry: entry("after", "assistant", "result"), childEntryIds: [] },
  ];
}

describe("conversation history tool pairing", () => {
  it("projects a direct matching request/result as one visible flow node", () => {
    const records = new Map([["tool_pair", toolRecord()]]);
    const graph = buildHistoryGraph(tree(), "entry_result", records);
    assert.equal(graph.rows.length, 3);
    const paired = graph.rows[1];
    assert.deepEqual(paired.underlyingEntryIds, [
      "entry_request",
      "entry_result",
    ]);
    assert.equal(paired.pairedResultEntry?.id, "entry_result");
    assert.equal(paired.isActive, true);

    const visible = buildHistoryVisible(graph.rows, records, new Set());
    assert.equal(visible.items.length, 3);
    const view = buildHistoryEntryView(
      paired.node.entry,
      records,
      paired.pairedResultEntry,
    );
    assert.match(view.argsText, /echo hi/);
    assert.equal(view.resultText, "command output");
    assert.equal(view.timingText, "1.0 s");

    const flow = buildHistoryFlow({
      visible,
      hasConversation: true,
      rootActive: false,
      rootOnActivePath: true,
      selectedKey: "e:entry_request",
      entryViewById: new Map(
        graph.rows.map((row) => [
          row.node.entry.id,
          buildHistoryEntryView(row.node.entry, records, row.pairedResultEntry),
        ]),
      ),
    });
    assert.equal(flow.nodes.length, 4);
    assert.equal(
      flow.visibleNodeIdByEntryId.get("entry_request"),
      flow.visibleNodeIdByEntryId.get("entry_result"),
    );
    assert.ok(
      flow.edges.some(
        (edge) =>
          edge.source === "history-entry:entry_request" &&
          edge.target === "history-entry:entry_after",
      ),
    );
  });

  it("keeps incomplete, mismatched, non-direct, and branched entries separate", () => {
    const records = new Map([
      ["tool_pair", toolRecord()],
      ["tool_other", toolRecord("tool_other", "provider_other")],
    ]);
    assert.equal(
      buildHistoryGraph(
        tree(
          {},
          {
            toolRecordId: "tool_pair",
            toolCallId: "provider_pair",
            toolName: "bash",
          },
        ),
        undefined,
        records,
      ).rows.length,
      4,
    );
    assert.equal(
      buildHistoryGraph(
        tree(
          {},
          {
            toolRecordId: "tool_other",
            toolCallId: "provider_other",
            toolName: "bash",
          },
        ),
        undefined,
        records,
      ).rows.length,
      4,
    );

    const branched = tree();
    branched[1].childEntryIds.push("entry_branch");
    branched.push({
      entry: entry("branch", "system", "request", {
        toolRecordId: "tool_pair",
        toolName: "bash",
      }),
      childEntryIds: [],
    });
    assert.equal(
      buildHistoryGraph(branched, undefined, records).rows.length,
      5,
    );

    const nonDirect = tree();
    nonDirect[2].entry.parentEntryId = "entry_user";
    assert.equal(
      buildHistoryGraph(nonDirect, undefined, records).rows.length,
      4,
    );
  });
});
