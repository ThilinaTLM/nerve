import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectSandboxSummariesFromEvents } from "../src/protocol/conversation-event-projection.js";
import type { StoredSandboxEvent } from "../src/state/event-store.js";

const ts = "2026-06-26T12:00:00.000Z";

function event(
  seq: number,
  type: string,
  payload: Record<string, unknown>,
): StoredSandboxEvent {
  return {
    sandboxId: "sbx_1",
    seq,
    type,
    ts: new Date(Date.parse(ts) + seq * 1000).toISOString(),
    durability: "durable",
    payload,
  };
}

describe("projectSandboxSummariesFromEvents", () => {
  it("projects multiple conversations and terminal run state from durable events", () => {
    const summaries = projectSandboxSummariesFromEvents({
      sandboxId: "sbx_1",
      events: [
        event(1, "run.started", {
          conversationId: "conv_a",
          agentId: "agent_main",
          runId: "run_a",
          promptSummary: "first task",
        }),
        event(2, "run.transcript.appended", {
          conversationId: "conv_a",
          agentId: "agent_main",
          runId: "run_a",
          role: "user",
          content: { text: "first task details" },
        }),
        event(3, "run.completed", {
          conversationId: "conv_a",
          agentId: "agent_main",
          runId: "run_a",
        }),
        event(4, "run.started", {
          conversationId: "conv_b",
          agentId: "agent_main",
          runId: "run_b",
          promptSummary: "second task",
        }),
      ],
    });

    assert.deepEqual(
      summaries.conversations
        .map((conversation) => conversation.conversationId)
        .sort(),
      ["conv_a", "conv_b"],
    );
    assert.equal(
      summaries.conversations.find(
        (conversation) => conversation.conversationId === "conv_a",
      )?.title,
      "first task details",
    );
    assert.deepEqual(
      summaries.conversations.find(
        (conversation) => conversation.conversationId === "conv_a",
      )?.activeRunIds,
      [],
    );
    assert.deepEqual(
      summaries.conversations.find(
        (conversation) => conversation.conversationId === "conv_b",
      )?.activeRunIds,
      ["run_b"],
    );
    assert.equal(
      summaries.runs.find((run) => run.runId === "run_a")?.status,
      "completed",
    );
    assert.equal(
      summaries.runs.find((run) => run.runId === "run_b")?.status,
      "running",
    );
  });
});
