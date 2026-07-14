import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConversationRuntime } from "../src/domains/conversations/index.js";

function start(runtime: ConversationRuntime) {
  const run = runtime.startRun({
    conversationId: "conv_test",
    agentId: "agent_test",
    projectId: "proj_test",
    runId: "run_test",
    startedAt: "2026-01-01T00:00:00.000Z",
  });
  const turn = runtime.startTurn(run.runId);
  const message = runtime.startAssistantMessage(run.runId, turn.turnId);
  return { run, turn, message };
}

describe("ConversationRuntime", () => {
  it("tracks live text deltas and done payloads in snapshots", () => {
    const runtime = new ConversationRuntime();
    const { run, message } = start(runtime);

    const first = runtime.applyContentDelta({
      runId: run.runId,
      turnId: message.turnId,
      liveMessageId: message.liveMessageId,
      contentIndex: 0,
      kind: "text",
      delta: "Hel",
    });
    const second = runtime.applyContentDelta({
      runId: run.runId,
      turnId: message.turnId,
      liveMessageId: message.liveMessageId,
      contentIndex: 0,
      kind: "text",
      delta: "lo",
    });
    const done = runtime.finishContent({
      runId: run.runId,
      turnId: message.turnId,
      liveMessageId: message.liveMessageId,
      contentIndex: 0,
      kind: "text",
    });

    assert.equal(first.offset, 0);
    assert.equal(second.offset, 3);
    assert.equal(done.contentBlockId, first.contentBlockId);
    const snapshot = runtime.snapshotForConversation("conv_test");
    const block = snapshot?.turns[0]?.messages[0]?.blocks[0];
    assert.equal(block?.kind, "text");
    assert.equal(block?.text, "Hello");
    assert.equal(block?.done, true);
  });

  it("preserves redacted thinking fallback state", () => {
    const runtime = new ConversationRuntime();
    const { run, message } = start(runtime);

    runtime.applyContentDelta({
      runId: run.runId,
      turnId: message.turnId,
      liveMessageId: message.liveMessageId,
      contentIndex: 0,
      kind: "thinking",
      delta: "private chain",
    });
    const done = runtime.finishContent({
      runId: run.runId,
      turnId: message.turnId,
      liveMessageId: message.liveMessageId,
      contentIndex: 0,
      kind: "thinking",
      finalText: "",
      redacted: true,
    });

    assert.equal(done.redacted, true);
    const block =
      runtime.snapshotForConversation("conv_test")?.turns[0]?.messages[0]
        ?.blocks[0];
    assert.equal(block?.kind, "thinking");
    assert.equal(block?.text, "");
    assert.equal(block?.redacted, true);
  });

  it("tracks tool-call draft lifecycle and anchors", () => {
    const runtime = new ConversationRuntime();
    const { run, message } = start(runtime);

    const started = runtime.startToolDraft({
      runId: run.runId,
      turnId: message.turnId,
      liveMessageId: message.liveMessageId,
      contentIndex: 1,
      providerToolCallId: "provider_tool_1",
      toolName: "bash",
    });
    const delta = runtime.applyToolDraftDelta({
      runId: run.runId,
      turnId: message.turnId,
      liveMessageId: message.liveMessageId,
      contentIndex: 1,
      providerToolCallId: "provider_tool_1",
      delta: '{"command":"echo hi"}',
    });
    const done = runtime.finishToolDraft({
      runId: run.runId,
      turnId: message.turnId,
      liveMessageId: message.liveMessageId,
      contentIndex: 1,
      providerToolCallId: "provider_tool_1",
      toolName: "bash",
      args: { command: "echo hi" },
    });

    assert.equal(delta.offset, 0);
    assert.equal(done.contentBlockId, started.contentBlockId);
    assert.deepEqual(runtime.resolveToolAnchor(run.runId, "provider_tool_1"), {
      runId: run.runId,
      turnId: message.turnId,
      liveMessageId: message.liveMessageId,
      contentIndex: 1,
      providerToolCallId: "provider_tool_1",
    });
  });

  it("caps live tool output tails", () => {
    const runtime = new ConversationRuntime();
    const { run, message } = start(runtime);

    runtime.applyToolOutputDelta({
      conversationId: "conv_test",
      agentId: "agent_test",
      projectId: "proj_test",
      runId: run.runId,
      turnId: message.turnId,
      liveMessageId: message.liveMessageId,
      contentIndex: 1,
      toolCallId: "tool_1",
      toolName: "bash",
      stream: "stdout",
      delta: "x".repeat(40_000),
    });

    const output =
      runtime.snapshotForConversation("conv_test")?.toolOutputsByToolCallId
        .tool_1;
    assert.equal(output?.text.length, 32_000);
    assert.equal(output?.outputLimits?.capped, true);
    assert.equal(output?.outputLimits?.omittedChars, 8_000);
  });

  it("hides materialized messages from snapshots while keeping ordinals stable", () => {
    const runtime = new ConversationRuntime();
    const { run, turn, message } = start(runtime);
    runtime.applyContentDelta({
      runId: run.runId,
      turnId: turn.turnId,
      liveMessageId: message.liveMessageId,
      contentIndex: 0,
      kind: "thinking",
      delta: "first thought",
    });

    runtime.markMessageMaterialized(
      run.runId,
      turn.turnId,
      message.liveMessageId,
    );

    const snapshot = runtime.snapshotForConversation("conv_test");
    assert.deepEqual(snapshot?.turns[0]?.messages, []);

    // Ordinals keep counting past materialized messages.
    const next = runtime.startAssistantMessage(run.runId, turn.turnId);
    assert.equal(next.messageOrdinal, message.messageOrdinal + 1);
    const refreshed = runtime.snapshotForConversation("conv_test");
    assert.deepEqual(
      refreshed?.turns[0]?.messages.map((entry) => entry.liveMessageId),
      [next.liveMessageId],
    );
    assert.equal(
      "materialized" in (refreshed?.turns[0]?.messages[0] ?? {}),
      false,
    );
  });

  it("ignores materialization for unknown runs, turns, and messages", () => {
    const runtime = new ConversationRuntime();
    const { run, turn, message } = start(runtime);

    runtime.markMessageMaterialized(
      "run_other",
      turn.turnId,
      message.liveMessageId,
    );
    runtime.markMessageMaterialized(
      run.runId,
      "turn_other",
      message.liveMessageId,
    );
    runtime.markMessageMaterialized(run.runId, turn.turnId, "msg_other");

    const snapshot = runtime.snapshotForConversation("conv_test");
    assert.equal(snapshot?.turns[0]?.messages.length, 1);
  });

  it("removes active run state on completion", () => {
    const runtime = new ConversationRuntime();
    const { run } = start(runtime);
    assert.ok(runtime.snapshotForConversation("conv_test"));
    runtime.completeRun(run.runId);
    assert.equal(runtime.snapshotForConversation("conv_test"), undefined);
  });
});
