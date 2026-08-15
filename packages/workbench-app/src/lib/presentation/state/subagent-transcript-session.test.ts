import type {
  EventEnvelope,
  SubagentTranscriptSnapshot,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyConversationEvent,
  applySubagentTranscriptEvent,
  buildConversationRenderProjection,
  emptyConversationRenderState,
  fromSubagentTranscriptSnapshot,
} from "./index.js";

const ts = "2026-08-02T00:00:00.000Z";
const identity = {
  conversationId: "conv_test",
  projectId: "proj_test",
  parentAgentId: "agent_parent",
  childAgentId: "agent_child",
  runId: "run_child",
};

function event(
  seq: number,
  type: string,
  data: Record<string, unknown>,
): EventEnvelope<Record<string, unknown>> {
  return { seq, type, data, id: `evt_${seq}`, ts };
}

function snapshot(): SubagentTranscriptSnapshot {
  return {
    agentId: "agent_child",
    parentAgentId: "agent_parent",
    conversationId: "conv_test",
    projectId: "proj_test",
    cursorSeq: 20,
    status: "running",
    entries: [],
    toolCalls: [],
    totalEntryCount: 0,
    totalToolCallCount: 0,
    entriesTruncated: false,
    toolCallsTruncated: false,
    updatedAt: ts,
  };
}

function hiddenTool(): ToolCallTranscriptRecord {
  return {
    id: "tool_child",
    sourceToolCallId: "call_child",
    providerToolCallId: "call_child",
    conversationId: "conv_test",
    agentId: "agent_child",
    projectId: "proj_test",
    runId: "run_child",
    toolName: "read",
    risk: "read",
    cwd: "/workspace",
    status: "running",
    revision: 1,
    attempt: 1,
    interactions: [],
    hidden: true,
    createdAt: ts,
    updatedAt: ts,
  };
}

describe("subagent transcript session", () => {
  it("projects child text incrementally across unrelated stream sequences", () => {
    let state = fromSubagentTranscriptSnapshot(snapshot());
    state = applySubagentTranscriptEvent(
      state,
      event(24, "agent.subagent_transcript.run.started", {
        ...identity,
        startedAt: ts,
      }),
    );
    state = applySubagentTranscriptEvent(
      state,
      event(31, "agent.subagent_transcript.turn.started", {
        ...identity,
        turnId: "turn_child",
        ordinal: 0,
      }),
    );
    state = applySubagentTranscriptEvent(
      state,
      event(33, "agent.subagent_transcript.message.started", {
        ...identity,
        turnId: "turn_child",
        liveMessageId: "msg_child",
        messageOrdinal: 0,
        startedAt: ts,
      }),
    );
    state = applySubagentTranscriptEvent(
      state,
      event(40, "agent.subagent_transcript.content.delta", {
        ...identity,
        turnId: "turn_child",
        liveMessageId: "msg_child",
        contentBlockId: "block_child",
        contentIndex: 0,
        kind: "text",
        offset: 0,
        delta: "Streaming now",
      }),
    );
    const projection = buildConversationRenderProjection(state);
    assert.equal(projection.streamingText, "Streaming now");
    assert.equal(projection.hasActiveTurnOutput, true);
  });

  it("retains hidden child tools only with the explicit reducer option", () => {
    const update = event(1, "toolCall.updated", {
      conversationId: "conv_test",
      agentId: "agent_child",
      projectId: "proj_test",
      runId: "run_child",
      toolCall: hiddenTool(),
    });
    const parent = applyConversationEvent(
      emptyConversationRenderState("conv_test"),
      update,
    );
    assert.equal(parent.toolCalls.length, 0);

    const runningChild = applySubagentTranscriptEvent(
      fromSubagentTranscriptSnapshot(snapshot()),
      event(1, "agent.subagent_transcript.run.started", {
        ...identity,
        startedAt: ts,
      }),
    );
    const child = applySubagentTranscriptEvent(runningChild, {
      ...update,
      seq: 2,
      id: "evt_2",
    });
    assert.equal(child.toolCalls.length, 1);
    assert.equal(buildConversationRenderProjection(child).timeline.length, 1);
  });

  it("reports canonical content-offset gaps without clearing current state", () => {
    let state = fromSubagentTranscriptSnapshot(snapshot());
    for (const [seq, type, data] of [
      [
        1,
        "agent.subagent_transcript.run.started",
        { ...identity, startedAt: ts },
      ],
      [
        2,
        "agent.subagent_transcript.turn.started",
        { ...identity, turnId: "turn_child", ordinal: 0 },
      ],
      [
        3,
        "agent.subagent_transcript.message.started",
        {
          ...identity,
          turnId: "turn_child",
          liveMessageId: "msg_child",
          messageOrdinal: 0,
          startedAt: ts,
        },
      ],
    ] as const) {
      state = applySubagentTranscriptEvent(state, event(seq, type, data));
    }
    let gap = false;
    const next = applySubagentTranscriptEvent(
      state,
      event(4, "agent.subagent_transcript.content.delta", {
        ...identity,
        turnId: "turn_child",
        liveMessageId: "msg_child",
        contentBlockId: "block_child",
        contentIndex: 0,
        kind: "text",
        offset: 5,
        delta: "bad",
      }),
      () => (gap = true),
    );
    assert.equal(gap, true);
    assert.equal(buildConversationRenderProjection(next).streamingText, "");
  });
});
