import type { ConversationViewState } from "$lib/core/types/state-types";
import type { ConversationEntry } from "@nervekit/contracts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  optimisticUserMessage,
  reconcileOptimisticMessages,
} from "./conversation-optimistic";
import {
  applyConversationTerminalUiState,
  applyRunWaitingProjection,
  stoppingAfterConversationSnapshot,
} from "./conversation-terminal-state";

const now = "2026-01-01T00:00:00.000Z";

function entry(overrides: Partial<ConversationEntry> = {}): ConversationEntry {
  return {
    id: "entry_01H00000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    role: "assistant",
    kind: "message",
    text: "Answer",
    createdAt: now,
    ...overrides,
  };
}

describe("conversation terminal event effects", () => {
  it("projects live waits onto the matching active run", () => {
    const queuedPrompt = {
      id: "promptq_waiting",
      agentId: "agent_waiting",
      conversationId: "conv_waiting",
      projectId: "proj_waiting",
      runId: "run_waiting",
      behavior: "steer" as const,
      text: "queued",
      status: "queued" as const,
      createdAt: now,
      updatedAt: now,
    };
    const view = {
      conversationId: "conv_waiting",
      activeRun: {
        runId: "run_waiting",
        agentId: "agent_waiting",
        projectId: "proj_waiting",
        conversationId: "conv_waiting",
        status: "running",
        startedAt: now,
        turns: [],
        toolOutputsByToolCallId: {},
        queuedPrompts: [queuedPrompt],
      },
      queuedPrompts: [queuedPrompt],
      sending: true,
      error: "stale",
    } as unknown as ConversationViewState;

    applyRunWaitingProjection(view, "run_waiting");

    assert.equal(view.activeRun?.status, "waiting");
    assert.equal(view.sending, false);
    assert.deepEqual(view.queuedPrompts, []);
    assert.deepEqual(view.activeRun?.queuedPrompts, []);
    assert.equal(view.error, undefined);
  });

  it("clears app-only stopping and optimistic projections", () => {
    const view = {
      optimisticMessages: [optimisticUserMessage("Stop this run")],
      stopping: true,
    };

    applyConversationTerminalUiState(view);

    assert.equal(view.stopping, false);
    assert.deepEqual(view.optimisticMessages, []);
  });

  it("preserves stopping only while a snapshot shows the same run", () => {
    assert.equal(
      stoppingAfterConversationSnapshot(true, "run_1", "run_1"),
      true,
    );
    assert.equal(
      stoppingAfterConversationSnapshot(true, "run_1", undefined),
      false,
    );
    assert.equal(
      stoppingAfterConversationSnapshot(true, "run_1", "run_2"),
      false,
    );
  });
});

describe("optimistic message reconciliation", () => {
  it("drops the echoed prompt once a durable user entry arrives", () => {
    const optimistic = [optimisticUserMessage("Run the tests")];
    const next = reconcileOptimisticMessages(
      optimistic,
      entry({ role: "user", text: "Run the tests" }),
    );
    assert.deepEqual(next, []);
  });
});
