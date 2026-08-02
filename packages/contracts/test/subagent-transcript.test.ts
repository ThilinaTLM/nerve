import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SUBAGENT_TRANSCRIPT_MAX_ENTRIES,
  subagentTranscriptEntrySchema,
  subagentTranscriptSnapshotSchema,
} from "../src/index.js";

const entry = {
  id: "entry_child_1",
  conversationId: "conv_child_1",
  agentId: "agent_child_1",
  role: "assistant" as const,
  kind: "message" as const,
  text: "Done.",
  details: {
    thinkingBlocks: [{ text: "Checked the source.", redacted: false }],
  },
  createdAt: "2026-08-02T00:00:00.000Z",
};

describe("subagent transcript contracts", () => {
  it("accepts bounded transport-neutral transcript entries", () => {
    assert.equal(subagentTranscriptEntrySchema.parse(entry).text, "Done.");
    const snapshot = subagentTranscriptSnapshotSchema.parse({
      agentId: "agent_child_1",
      parentAgentId: "agent_parent_1",
      status: "idle",
      entries: [entry],
      toolCalls: [],
      totalEntryCount: 1,
      totalToolCallCount: 0,
      entriesTruncated: false,
      toolCallsTruncated: false,
      updatedAt: "2026-08-02T00:00:00.000Z",
    });
    assert.equal(snapshot.entries.length, 1);
  });

  it("rejects arbitrary details and oversized entry collections", () => {
    assert.equal(
      subagentTranscriptEntrySchema.safeParse({
        ...entry,
        details: { providerPayload: { secret: "nope" } },
      }).success,
      false,
    );
    assert.equal(
      subagentTranscriptSnapshotSchema.safeParse({
        agentId: "agent_child_1",
        parentAgentId: "agent_parent_1",
        status: "idle",
        entries: Array.from(
          { length: SUBAGENT_TRANSCRIPT_MAX_ENTRIES + 1 },
          (_, index) => ({ ...entry, id: `entry_child_${index}` }),
        ),
        toolCalls: [],
        totalEntryCount: SUBAGENT_TRANSCRIPT_MAX_ENTRIES + 1,
        totalToolCallCount: 0,
        entriesTruncated: false,
        toolCallsTruncated: false,
        updatedAt: "2026-08-02T00:00:00.000Z",
      }).success,
      false,
    );
  });
});
