import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySandboxEvent } from "./sandbox-event-reducers";
import {
  createSandboxDetailState,
  type SandboxUiEvent,
} from "./sandbox-ui-types";

const ts = "2026-06-26T12:00:00.000Z";
const scope = {
  instanceId: "inst_1",
  conversationId: "conv_1",
  agentId: "agent_1",
  runId: "run_1",
};

function event(
  seq: number,
  type: string,
  data: Record<string, unknown>,
  durability: "durable" | "transient" = "durable",
): SandboxUiEvent {
  return { stream: "sandbox:sbx_1", seq, ts, type, durability, data };
}

describe("applySandboxEvent", () => {
  it("tracks run lifecycle, streaming deltas, and durable transcript", () => {
    const detail = createSandboxDetailState("sbx_1");
    applySandboxEvent(
      detail,
      event(1, "run.started", {
        ...scope,
        commandId: "cmd_1",
        status: "running",
        model: { provider: "anthropic", model: "claude" },
        startedAt: ts,
      }),
    );
    assert.equal(detail.selectedRunId, "run_1");
    assert.equal(detail.selectedConversationId, "conv_1");

    applySandboxEvent(
      detail,
      event(
        2,
        "run.delta",
        { ...scope, deltaId: "d1", role: "assistant", text: "Hel" },
        "transient",
      ),
    );
    applySandboxEvent(
      detail,
      event(
        3,
        "run.delta",
        { ...scope, deltaId: "d2", role: "assistant", text: "lo" },
        "transient",
      ),
    );
    assert.equal(detail.liveRuns.run_1.deltaText, "Hello");

    applySandboxEvent(
      detail,
      event(4, "run.transcript.appended", {
        ...scope,
        entryId: "entry_1",
        index: 0,
        role: "assistant",
        content: { text: "Hello" },
        createdAt: ts,
      }),
    );
    assert.equal(detail.appendedTranscript.length, 1);
    // Durable transcript clears transient streaming text for the run.
    assert.equal(detail.liveRuns.run_1.deltaText, "");

    applySandboxEvent(
      detail,
      event(5, "run.completed", {
        ...scope,
        status: "completed",
        completedAt: ts,
      }),
    );
    assert.equal(detail.liveRuns.run_1.status, "completed");
  });

  it("upserts tool calls by id across lifecycle events", () => {
    const detail = createSandboxDetailState("sbx_1");
    applySandboxEvent(
      detail,
      event(1, "tool.call.requested", {
        ...scope,
        toolCallId: "tool_1",
        toolName: "read",
        status: "requested",
        displayArgs: { path: "README.md" },
        requestedAt: ts,
      }),
    );
    applySandboxEvent(
      detail,
      event(2, "tool.call.completed", {
        ...scope,
        toolCallId: "tool_1",
        toolName: "read",
        status: "completed",
        completedAt: ts,
      }),
    );
    const toolCall = detail.toolCallsById.tool_1;
    assert.equal(toolCall.status, "completed");
    assert.deepEqual(toolCall.displayArgs, { path: "README.md" });
  });

  it("creates input and approval wait records", () => {
    const detail = createSandboxDetailState("sbx_1");
    applySandboxEvent(
      detail,
      event(1, "run.waiting_for_input", {
        ...scope,
        requestId: "wait_input",
        question: { text: "Proceed?" },
        required: true,
        createdAt: ts,
      }),
    );
    applySandboxEvent(
      detail,
      event(2, "run.waiting_for_approval", {
        ...scope,
        approvalId: "wait_appr",
        toolCallId: "tool_1",
        risk: ["shell"],
        reason: "needs approval",
        normalizedArgs: {},
        createdAt: ts,
      }),
    );
    assert.equal(detail.waitsById.wait_input.kind, "input");
    assert.equal(detail.waitsById.wait_appr.kind, "approval");
    assert.equal(detail.waitsById.wait_appr.status, "waiting");
  });

  it("deduplicates event log entries and records setup timeline", () => {
    const detail = createSandboxDetailState("sbx_1");
    const boot = event(1, "sandbox.boot.started", { ...scope });
    applySandboxEvent(detail, boot);
    applySandboxEvent(detail, boot);
    assert.equal(detail.events.length, 1);
    assert.equal(detail.setupTimeline[0].phase, "boot");
    assert.equal(detail.setupTimeline[0].status, "started");
  });
});
