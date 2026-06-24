import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRecord, ConversationEntry } from "@nervekit/shared";
import { RetryContinuationService } from "../src/domains/agents/retry-continuation.service.js";
import type { RuntimeState } from "../src/runtime/runtime-state.js";

const AGENT: AgentRecord = {
  id: "agent_1",
  conversationId: "conv_1",
} as unknown as AgentRecord;

function entry(partial: Partial<ConversationEntry>): ConversationEntry {
  return {
    id: "entry_x",
    conversationId: "conv_1",
    role: "system",
    kind: "message",
    text: "",
    createdAt: new Date().toISOString(),
    ...partial,
  } as ConversationEntry;
}

function makeService(entries: ConversationEntry[]) {
  const calls: { continueFromFailedTurn: string[]; resumeRun: string[] } = {
    continueFromFailedTurn: [],
    resumeRun: [],
  };
  const state = {
    getAgent: () => AGENT,
    runs: new Map<string, unknown>(),
  } as unknown as RuntimeState;
  const service = new RetryContinuationService({
    state,
    getConversationEntries: () => entries,
    continueFromFailedTurn: async (_agentId, failedEntryId) => {
      calls.continueFromFailedTurn.push(failedEntryId);
    },
    resumeRun: async (agentId) => {
      calls.resumeRun.push(agentId);
    },
  });
  return { service, calls };
}

describe("RetryContinuationService.continueFromFailedTurn", () => {
  it("rewinds and re-runs a re-runnable failed model turn", async () => {
    const failed = entry({
      id: "entry_fail",
      role: "assistant",
      kind: "message",
      details: { stopReason: "error", errorMessage: "boom" },
    });
    const status = entry({
      id: "entry_status",
      kind: "run_status",
      details: {
        type: "agent_run_retry_status",
        state: "failed",
        retryable: true,
        failedEntryId: "entry_fail",
      },
    });
    const { service, calls } = makeService([failed, status]);

    await service.continueFromFailedTurn("agent_1", "entry_status");

    assert.deepEqual(calls.continueFromFailedTurn, ["entry_fail"]);
    assert.deepEqual(calls.resumeRun, []);
  });

  it("resumes forward for an interrupted status with no failed turn", async () => {
    const status = entry({
      id: "entry_status",
      kind: "run_status",
      details: {
        type: "agent_run_retry_status",
        state: "interrupted",
        retryable: true,
      },
    });
    const { service, calls } = makeService([status]);

    await service.continueFromFailedTurn("agent_1", "entry_status");

    assert.deepEqual(calls.resumeRun, ["agent_1"]);
    assert.deepEqual(calls.continueFromFailedTurn, []);
  });

  it("resumes forward when the referenced entry is not a failed model turn", async () => {
    const ok = entry({
      id: "entry_ok",
      role: "assistant",
      kind: "message",
      details: undefined,
    });
    const status = entry({
      id: "entry_status",
      kind: "run_status",
      details: {
        type: "agent_run_retry_status",
        state: "failed",
        retryable: true,
        failedEntryId: "entry_ok",
      },
    });
    const { service, calls } = makeService([ok, status]);

    await service.continueFromFailedTurn("agent_1", "entry_status");

    assert.deepEqual(calls.resumeRun, ["agent_1"]);
    assert.deepEqual(calls.continueFromFailedTurn, []);
  });

  it("rejects a non-continuable run status", async () => {
    const status = entry({
      id: "entry_status",
      kind: "run_status",
      details: {
        type: "agent_run_retry_status",
        state: "retrying",
        retryable: true,
      },
    });
    const { service } = makeService([status]);

    await assert.rejects(
      service.continueFromFailedTurn("agent_1", "entry_status"),
      /continuable run-status entry/,
    );
  });

  it("rejects when the status entry is not at the branch tail", async () => {
    const status = entry({
      id: "entry_status",
      kind: "run_status",
      details: {
        type: "agent_run_retry_status",
        state: "failed",
        retryable: true,
      },
    });
    const trailing = entry({ id: "entry_later", role: "user" });
    const { service } = makeService([status, trailing]);

    await assert.rejects(
      service.continueFromFailedTurn("agent_1", "entry_status"),
      /end of the active conversation branch/,
    );
  });
});
