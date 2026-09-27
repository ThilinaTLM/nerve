import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentActivitySnapshotSchema,
  agentAsyncObligationSchema,
  assertAgentAsyncObligationReplacement,
  conversationActivitySnapshotSchema,
  type AgentAsyncObligation,
} from "../../src/domains/agents/index.js";
import { validatePublicEvent } from "../../src/events/index.js";

const createdAt = "2026-09-27T10:00:00.000Z";
const pending: AgentAsyncObligation = {
  id: "promoted_task:task_1:0",
  conversationId: "conv_1",
  ownerAgentId: "agent_1",
  sourceKind: "promoted_task",
  sourceId: "task_1",
  state: "pending",
  notificationEntryId: "entry_task_1",
  generation: 0,
  createdAt,
  updatedAt: createdAt,
};

describe("agent async obligations", () => {
  it("validates obligations and legal monotonic replacements", () => {
    const parsed = agentAsyncObligationSchema.parse(pending);
    const ready = {
      ...parsed,
      state: "ready" as const,
      outcome: "completed",
      updatedAt: "2026-09-27T10:01:00.000Z",
    };
    assert.doesNotThrow(() =>
      assertAgentAsyncObligationReplacement(parsed, ready),
    );
    assert.throws(
      () => assertAgentAsyncObligationReplacement(ready, parsed),
      /state regressed/,
    );
  });

  it("rejects identity changes and incomplete terminal timestamps", () => {
    assert.throws(
      () =>
        assertAgentAsyncObligationReplacement(pending, {
          ...pending,
          sourceId: "task_2",
        }),
      /immutable field/,
    );
    assert.equal(
      agentAsyncObligationSchema.safeParse({ ...pending, state: "consumed" })
        .success,
      false,
    );
  });
});

describe("activity snapshots and events", () => {
  const agentActivity = {
    agentId: "agent_1",
    conversationId: "conv_1",
    state: "awaiting_async" as const,
    pendingInteractionCount: 0,
    pendingAsyncCount: 2,
    updatedAt: createdAt,
  };

  it("validates complete agent and conversation snapshots", () => {
    assert.equal(
      agentActivitySnapshotSchema.parse(agentActivity).pendingAsyncCount,
      2,
    );
    assert.equal(
      conversationActivitySnapshotSchema.parse({
        conversationId: "conv_1",
        activeAgentId: "agent_1",
        state: "completed",
        pendingInteractionCount: 0,
        pendingAsyncCount: 0,
        updatedAt: createdAt,
      }).state,
      "completed",
    );
  });

  it("registers full replacement activity events", () => {
    assert.deepEqual(
      validatePublicEvent(
        "agent.activity_changed",
        { activity: agentActivity },
        "workbench_server",
      ),
      { activity: agentActivity },
    );
    assert.throws(() =>
      validatePublicEvent(
        "conversation.activity_changed",
        { conversationId: "conv_1", state: "idle" },
        "workbench_server",
      ),
    );
  });
});
