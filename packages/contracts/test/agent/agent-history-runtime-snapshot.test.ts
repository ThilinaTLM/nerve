import assert from "node:assert/strict";
import test from "node:test";
import { parseOperationResult } from "../../src/operations/catalog.js";
import { agentHistoryResultSchema } from "../../src/domains/agents/agent-operations.js";

const now = "2026-10-07T00:00:00.000Z";
function history(agentId = "agent_additional_root") {
  return {
    agentId,
    conversationId: "conv_shared",
    entries: [],
    toolCalls: [],
    latestCompletion: null,
    effectiveConfiguration: null,
    cursorSeq: 42,
    activeEntryId: null,
    activeEntryIds: [],
    activeRun: {
      agentId,
      conversationId: "conv_shared",
      projectId: "proj_one",
      runId: "run_actual",
      status: "running",
      startedAt: now,
      turns: [],
      toolOutputsByToolCallId: {},
      queuedPrompts: [],
    },
    activity: {
      agentId,
      conversationId: "conv_shared",
      state: "running",
      activeRunId: "run_actual",
      pendingInteractionCount: 0,
      pendingAsyncCount: 0,
      updatedAt: now,
    },
  };
}

test("common operation result retains validated live history for additional roots and orphans without parent fallback", () => {
  for (const agentId of ["agent_additional_root", "agent_orphan"]) {
    const value = history(agentId);
    assert.deepEqual(agentHistoryResultSchema.parse(value), value);
    assert.deepEqual(
      parseOperationResult(
        "agent.history.get",
        JSON.parse(JSON.stringify(value)),
      ),
      value,
    );
    assert.equal("parentAgentId" in value, false);
  }
});

test("current history requires all durable owner fields while absent runtime snapshots mean none", () => {
  const { activeRun, activity, ...idle } = history();
  assert.deepEqual(agentHistoryResultSchema.parse(idle), idle);
  for (const field of [
    "agentId",
    "conversationId",
    "entries",
    "toolCalls",
    "activeEntryId",
    "activeEntryIds",
    "cursorSeq",
    "latestCompletion",
    "effectiveConfiguration",
  ] as const) {
    const incomplete = { ...idle, [field]: undefined };
    assert.equal(
      agentHistoryResultSchema.safeParse(incomplete).success,
      false,
      field,
    );
    assert.throws(() => parseOperationResult("agent.history.get", incomplete));
  }
  assert.equal(
    agentHistoryResultSchema.safeParse({ ...idle, activeRun }).success,
    true,
  );
  assert.equal(
    agentHistoryResultSchema.safeParse({ ...idle, activity }).success,
    true,
  );
});

test("history rejects foreign or unscoped snapshots and disagreements about the actual active run", () => {
  const value = history();
  for (const corrupt of [
    { ...value, activeRun: { ...value.activeRun, agentId: "agent_sibling" } },
    {
      ...value,
      activeRun: { ...value.activeRun, conversationId: "conv_foreign" },
    },
    { ...value, activity: { ...value.activity, agentId: "agent_parent" } },
    {
      ...value,
      activity: { ...value.activity, conversationId: "conv_foreign" },
    },
    {
      ...value,
      activity: { ...value.activity, activeRunId: "run_replacement" },
    },
    { ...value, activity: { ...value.activity, activeRunId: undefined } },
    { ...value, agentId: undefined },
    { ...value, conversationId: undefined },
  ]) {
    assert.equal(agentHistoryResultSchema.safeParse(corrupt).success, false);
    assert.throws(() => parseOperationResult("agent.history.get", corrupt));
  }
});

test("invalid cursors, activity counters and fabricated active-run state fail at the operation boundary", () => {
  const value = history();
  for (const corrupt of [
    { ...value, cursorSeq: -1 },
    { ...value, cursorSeq: 1.5 },
    { ...value, cursorSeq: Number.MAX_SAFE_INTEGER + 1 },
    { ...value, activity: { ...value.activity, pendingInteractionCount: -1 } },
    { ...value, activeRun: { ...value.activeRun, startedAt: "invented" } },
    { ...value, activeRun: { ...value.activeRun, status: "completed" } },
  ])
    assert.throws(() => parseOperationResult("agent.history.get", corrupt));
});
