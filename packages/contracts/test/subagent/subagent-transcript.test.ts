import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SUBAGENT_TRANSCRIPT_MAX_ENTRIES,
  subagentTranscriptEntrySchema,
  subagentTranscriptSnapshotSchema,
  validatePublicEvent,
} from "../../src/index.js";

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
      conversationId: "conv_child_1",
      projectId: "proj_child_1",
      cursorSeq: 4,
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
        conversationId: "conv_child_1",
        projectId: "proj_child_1",
        cursorSeq: 4,
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

  it("accepts bounded child live events and rejects raw or malformed content", () => {
    const identity = {
      conversationId: "conv_child_1",
      projectId: "proj_child_1",
      parentAgentId: "agent_parent_1",
      childAgentId: "agent_child_1",
      runId: "run_child_1",
      turnId: "turn_child_1",
      liveMessageId: "msg_child_1",
      contentBlockId: "block_child_1",
      contentIndex: 0,
      kind: "text",
      offset: 0,
      delta: "Hello",
    };
    assert.equal(
      (
        validatePublicEvent(
          "agent.subagent_transcript.content.delta",
          identity,
          "workbench_server",
        ) as typeof identity
      ).delta,
      "Hello",
    );
    assert.throws(() =>
      validatePublicEvent(
        "agent.subagent_transcript.content.delta",
        { ...identity, offset: -1 },
        "workbench_server",
      ),
    );
    assert.throws(() =>
      validatePublicEvent(
        "agent.subagent_transcript.content.delta",
        { ...identity, args: { secret: true } },
        "workbench_server",
      ),
    );
  });
});
