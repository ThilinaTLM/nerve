import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ConversationActiveRunSnapshot,
  SandboxRunSnapshot,
} from "@nervekit/contracts";
import {
  isSandboxRunActive,
  resolveSandboxPromptDispatch,
  selectPreferredSandboxRun,
} from "./sandbox-prompt-routing";

const conversationId = "conv_test";
const agentId = "agent_test";
const projectId = "proj_test";

function snapshotRun(
  runId: string,
  status: SandboxRunSnapshot["status"],
  updatedAt: string,
): SandboxRunSnapshot {
  return {
    conversationId,
    agentId,
    runId,
    status,
    updatedAt,
  };
}

function richRun(
  status: ConversationActiveRunSnapshot["status"] = "running",
): ConversationActiveRunSnapshot {
  return {
    conversationId,
    agentId,
    projectId,
    runId: "run_active",
    status,
    startedAt: "2026-07-17T00:00:00.000Z",
    turns: [],
    toolOutputsByToolCallId: {},
    queuedPrompts: [],
  };
}

describe("sandbox prompt routing", () => {
  it("starts a new conversation without inventing scope identifiers", () => {
    const dispatch = resolveSandboxPromptDispatch({ text: "Hello" });

    assert.equal(dispatch.method, "run.start");
    assert.deepEqual(dispatch.params, {
      conversationId: undefined,
      agentId: undefined,
      text: "Hello",
    });
  });

  it("starts the next turn when the selected run is terminal", () => {
    const dispatch = resolveSandboxPromptDispatch({
      text: "Second turn",
      conversationId,
      agentId,
      selectedRunId: "run_completed",
      liveRuns: {
        run_completed: {
          conversationId,
          agentId,
          runId: "run_completed",
          status: "completed",
          deltaText: "",
        },
      },
      snapshotRuns: [
        snapshotRun("run_completed", "completed", "2026-07-17T00:01:00.000Z"),
      ],
    });

    assert.equal(dispatch.method, "run.start");
    assert.deepEqual(dispatch.params, {
      conversationId,
      agentId,
      text: "Second turn",
    });
  });

  it("queues against a rich active run with the required run id", () => {
    const dispatch = resolveSandboxPromptDispatch({
      text: "Do this next",
      conversationId,
      agentId,
      selectedRunId: "run_active",
      richActiveRun: richRun(),
    });

    assert.equal(dispatch.method, "run.followUp");
    assert.deepEqual(dispatch.params, {
      conversationId,
      agentId,
      runId: "run_active",
      text: "Do this next",
    });
  });

  it("recovers queueing from active snapshot summaries", () => {
    const dispatch = resolveSandboxPromptDispatch({
      text: "Recovered follow-up",
      conversationId,
      agentId,
      snapshotRuns: [
        snapshotRun("run_old", "completed", "2026-07-17T00:01:00.000Z"),
        snapshotRun(
          "run_waiting",
          "waiting_for_input",
          "2026-07-17T00:02:00.000Z",
        ),
      ],
    });

    assert.equal(dispatch.method, "run.followUp");
    assert.equal(dispatch.params.runId, "run_waiting");
  });

  it("keeps interrupted recoverable runs active", () => {
    const dispatch = resolveSandboxPromptDispatch({
      text: "Continue after recovery",
      conversationId,
      agentId,
      richActiveRun: richRun("interrupted"),
    });

    assert.equal(dispatch.method, "run.followUp");
    assert.equal(dispatch.params.runId, "run_active");
  });

  it("selects an active run before a newer terminal run", () => {
    const selected = selectPreferredSandboxRun([
      snapshotRun(
        "run_waiting",
        "waiting_for_approval",
        "2026-07-17T00:01:00.000Z",
      ),
      snapshotRun("run_completed", "completed", "2026-07-17T00:02:00.000Z"),
    ]);

    assert.equal(selected?.runId, "run_waiting");
    assert.equal(isSandboxRunActive("recoverable_failed"), true);
    assert.equal(isSandboxRunActive("completed"), false);
  });
});
