import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConversationRuntime } from "../src/domains/runs/runtime/conversation-runtime.js";

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
    const finishedBlock =
      runtime.snapshotForConversation("conv_test")?.turns[0]?.messages[0]
        ?.blocks[0];
    assert.equal(finishedBlock?.kind, "tool_call_draft");
    if (finishedBlock?.kind === "tool_call_draft") {
      assert.equal(finishedBlock.argsText, "");
    }
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

    for (let index = 0; index < 5; index += 1) {
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
        delta: "x".repeat(8_000),
      });
    }

    const output =
      runtime.snapshotForConversation("conv_test")?.toolOutputsByToolCallId
        .tool_1;
    assert.equal(output?.text.length, 32_000);
    assert.equal(output?.outputLimits?.capped, true);
    assert.equal(output?.outputLimits?.omittedChars, 8_000);
  });

  it("retains only tool-draft slots from materialized mixed messages", () => {
    const runtime = new ConversationRuntime();
    const { run, turn, message } = start(runtime);
    runtime.applyContentDelta({
      runId: run.runId,
      turnId: turn.turnId,
      liveMessageId: message.liveMessageId,
      contentIndex: 0,
      kind: "thinking",
      delta: "reasoning",
    });
    runtime.startToolDraft({
      runId: run.runId,
      turnId: turn.turnId,
      liveMessageId: message.liveMessageId,
      contentIndex: 1,
      providerToolCallId: "provider_tool_1",
      toolName: "write",
    });
    runtime.applyContentDelta({
      runId: run.runId,
      turnId: turn.turnId,
      liveMessageId: message.liveMessageId,
      contentIndex: 2,
      kind: "text",
      delta: "done",
    });

    runtime.markMessageMaterialized(
      run.runId,
      turn.turnId,
      message.liveMessageId,
    );

    const retained =
      runtime.snapshotForConversation("conv_test")?.turns[0]?.messages[0];
    assert.equal(retained?.liveMessageId, message.liveMessageId);
    assert.equal(retained?.messageOrdinal, message.messageOrdinal);
    assert.deepEqual(
      retained?.blocks.map((block) => block.kind),
      ["tool_call_draft"],
    );
    assert.equal("materialized" in (retained ?? {}), false);
  });

  it("does not retain a discarded draft after materialization", () => {
    const runtime = new ConversationRuntime();
    const { run, turn, message } = start(runtime);
    runtime.startToolDraft({
      runId: run.runId,
      turnId: turn.turnId,
      liveMessageId: message.liveMessageId,
      contentIndex: 0,
      toolName: "write",
    });
    runtime.discardToolDraft({
      runId: run.runId,
      turnId: turn.turnId,
      liveMessageId: message.liveMessageId,
      contentIndex: 0,
      reason: "invalid",
    });
    runtime.markMessageMaterialized(
      run.runId,
      turn.turnId,
      message.liveMessageId,
    );

    assert.deepEqual(
      runtime.snapshotForConversation("conv_test")?.turns[0]?.messages,
      [],
    );
  });

  it("guards live message and turn terminal transitions", () => {
    const runtime = new ConversationRuntime();
    const { run, turn, message } = start(runtime);

    runtime.completeAssistantMessage(
      run.runId,
      turn.turnId,
      message.liveMessageId,
    );
    assert.throws(
      () =>
        runtime.failAssistantMessage(
          run.runId,
          turn.turnId,
          message.liveMessageId,
        ),
      /Illegal lifecycle transition completed -> failed/,
    );
    runtime.completeTurn(run.runId, turn.turnId);
    assert.throws(
      () => runtime.failTurn(run.runId, turn.turnId),
      /Illegal lifecycle transition completed -> failed/,
    );
  });

  it("uses injected clocks and IDs and rejects duplicate active ownership", () => {
    const ids = ["turn_fixed", "msg_fixed"];
    const runtime = new ConversationRuntime({
      now: () => new Date("2026-02-03T04:05:06.000Z"),
      createId: () => ids.shift() ?? "block_fixed",
    });
    const run = runtime.startRun({
      conversationId: "conv_test",
      agentId: "agent_test",
      projectId: "proj_test",
      runId: "run_test",
    });
    assert.equal(run.startedAt, "2026-02-03T04:05:06.000Z");
    const turn = runtime.startTurn(run.runId);
    const message = runtime.startAssistantMessage(run.runId, turn.turnId);
    assert.equal(turn.turnId, "turn_fixed");
    assert.equal(message.liveMessageId, "msg_fixed");
    assert.throws(
      () =>
        runtime.startRun({
          conversationId: "conv_other",
          agentId: "agent_test",
          projectId: "proj_test",
          runId: "run_other",
        }),
      /already has an active run/,
    );
  });

  it("removes active run state on completion", () => {
    const runtime = new ConversationRuntime();
    const { run } = start(runtime);
    assert.ok(runtime.snapshotForConversation("conv_test"));
    runtime.completeRun(run.runId);
    assert.equal(runtime.snapshotForConversation("conv_test"), undefined);
  });
});
