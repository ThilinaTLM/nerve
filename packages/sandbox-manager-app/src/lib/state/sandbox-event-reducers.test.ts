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

  it("does not switch away from a selected pending conversation on background run events", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.selectedPendingConversationId = "pending_1";
    detail.pendingConversationsById.pending_1 = {
      id: "pending_1",
      title: "New Conversation",
      composerText: "draft",
      sending: false,
      createdAt: ts,
    };
    applySandboxEvent(
      detail,
      event(1, "run.started", {
        ...scope,
        commandId: "cmd_1",
        status: "running",
        startedAt: ts,
      }),
    );
    assert.equal(detail.selectedPendingConversationId, "pending_1");
    assert.equal(detail.selectedConversationId, undefined);
    assert.equal(detail.liveRuns.run_1.conversationId, "conv_1");
  });

  it("upserts tool calls by id across lifecycle events", () => {
    const detail = createSandboxDetailState("sbx_1");
    applySandboxEvent(
      detail,
      event(1, "toolCall.updated", {
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
      event(2, "toolCall.updated", {
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

  it("creates input and approval wait records and projects blocked statuses", () => {
    const detail = createSandboxDetailState("sbx_1");
    applySandboxEvent(
      detail,
      event(1, "run.started", {
        ...scope,
        commandId: "cmd_1",
        status: "running",
        startedAt: ts,
      }),
    );
    [
      ["wait_input", "ask_user"],
      ["tool_1", "bash"],
    ].forEach(([toolCallId, toolName], index) => {
      applySandboxEvent(
        detail,
        event(2 + index, "toolCall.updated", {
          ...scope,
          toolCallId,
          toolName,
          status: "started",
          startedAt: ts,
        }),
      );
    });
    applySandboxEvent(
      detail,
      event(4, "run.waiting_for_input", {
        ...scope,
        requestId: "wait_input",
        question: { text: "Proceed?" },
        required: true,
        createdAt: ts,
      }),
    );
    applySandboxEvent(
      detail,
      event(5, "run.waiting_for_approval", {
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
    assert.equal(detail.toolCallsById.wait_input.status, "waiting_for_input");
    assert.equal(detail.toolCallsById.tool_1.status, "waiting_for_approval");
    assert.equal(detail.liveRuns.run_1.status, "waiting_for_approval");
  });

  it("tracks and resolves plan-review waits", () => {
    const detail = createSandboxDetailState("sbx_1");
    applySandboxEvent(
      detail,
      event(1, "toolCall.updated", {
        ...scope,
        toolCallId: "plan_raw_1",
        toolName: "plan_mode_present",
        status: "started",
        startedAt: ts,
      }),
    );
    const planReview = {
      id: "plan_review_1",
      toolCallId: "tool_plan_1",
      agentId: "agent_1",
      conversationId: "conv_1",
      projectId: "proj_1",
      slug: "feature",
      planPath: "/state/plans/feature.md",
      content: "# Feature",
      status: "pending" as const,
      requestedAt: ts,
      updatedAt: ts,
    };
    applySandboxEvent(
      detail,
      event(2, "run.waiting_for_plan_review", {
        ...scope,
        reviewId: planReview.id,
        toolCallId: "plan_raw_1",
        planReview,
        createdAt: ts,
      }),
    );
    assert.equal(detail.waitsById.plan_review_1.kind, "plan_review");
    assert.equal(detail.toolCallsById.plan_raw_1.status, "waiting_for_input");
    applySandboxEvent(
      detail,
      event(3, "planReview.resolved", {
        ...scope,
        reviewId: planReview.id,
        decision: "accept",
        planReview: { ...planReview, status: "accepted" },
        resolvedAt: ts,
      }),
    );
    assert.equal(detail.waitsById.plan_review_1.status, "submitted");
    assert.equal(detail.waitsById.plan_review_1.planReview?.status, "accepted");
  });

  it("merges typed startup stage progress and failures", () => {
    const detail = createSandboxDetailState("sbx_1");
    applySandboxEvent(
      detail,
      event(1, "sandbox.startup.stage.started", {
        ...scope,
        stage: "preflight",
        attempt: 1,
        startedAt: "2026-06-26T11:59:58.000Z",
      }),
    );
    applySandboxEvent(
      detail,
      event(2, "sandbox.startup.stage.completed", {
        ...scope,
        stage: "preflight",
        attempt: 1,
        status: "failed",
        startedAt: "2026-06-26T11:59:58.000Z",
        completedAt: ts,
        durationMs: 2_000,
        error: { code: "MOUNT_INVALID", message: "workspace is not writable" },
      }),
    );
    assert.equal(detail.setupTimeline.length, 1);
    assert.equal(detail.setupTimeline[0]?.phase, "preflight");
    assert.equal(detail.setupTimeline[0]?.status, "failed");
    assert.equal(
      detail.setupTimeline[0]?.error,
      "MOUNT_INVALID: workspace is not writable",
    );
  });

  it("deduplicates event log entries and records setup timeline", () => {
    const detail = createSandboxDetailState("sbx_1");
    const boot = event(1, "sandbox.boot.started", {
      ...scope,
      phase: "install",
      index: 0,
      runAs: "sandbox",
      network: "inherit",
      timeoutMs: 30_000,
      startedAt: ts,
    });
    applySandboxEvent(detail, boot);
    applySandboxEvent(detail, boot);
    assert.equal(detail.events.length, 1);
    assert.equal(detail.setupTimeline[0].phase, "boot");
    assert.equal(detail.setupTimeline[0].status, "started");
    assert.equal(detail.setupTimeline[0].detail, "Boot phase: install");
    assert.equal(detail.setupTimeline[0].name, "install");
    assert.equal(detail.setupTimeline[0].runAs, "sandbox");
  });

  it("preserves boot metadata when completion events omit started-only fields", () => {
    const detail = createSandboxDetailState("sbx_1");
    applySandboxEvent(
      detail,
      event(1, "sandbox.boot.started", {
        ...scope,
        phase: "install",
        index: 0,
        runAs: "sandbox",
        network: "inherit",
        timeoutMs: 30_000,
        startedAt: "2026-06-26T11:59:58.000Z",
      }),
    );
    applySandboxEvent(
      detail,
      event(2, "sandbox.boot.completed", {
        ...scope,
        phase: "install",
        index: 0,
        status: "completed",
        startedAt: "2026-06-26T11:59:58.000Z",
        completedAt: ts,
        exitCode: 0,
      }),
    );

    assert.equal(detail.setupTimeline[0].status, "completed");
    assert.equal(detail.setupTimeline[0].runAs, "sandbox");
    assert.equal(detail.setupTimeline[0].network, "inherit");
    assert.equal(detail.setupTimeline[0].timeoutMs, 30_000);
  });

  it("records failed boot completion events as failed setup timeline items", () => {
    const detail = createSandboxDetailState("sbx_1");
    applySandboxEvent(
      detail,
      event(1, "sandbox.boot.completed", {
        ...scope,
        phase: "install",
        index: 0,
        status: "failed",
        exitCode: 127,
        startedAt: "2026-06-26T11:59:58.000Z",
        completedAt: ts,
        stderr: { text: "pnpm: not found", bytes: 15 },
      }),
    );
    assert.equal(detail.setupTimeline[0].phase, "boot");
    assert.equal(detail.setupTimeline[0].status, "failed");
    assert.equal(
      detail.setupTimeline[0].detail,
      "Boot phase: install · exit 127",
    );
    assert.equal(detail.setupTimeline[0].exitCode, 127);
    assert.equal(detail.setupTimeline[0].stderr?.text, "pnpm: not found");
    assert.equal(detail.setupTimeline[0].durationMs, 2000);
  });
});
