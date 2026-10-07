import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AgentAsyncObligation,
  AgentRecord,
} from "@nervekit/contracts/agents";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import {
  AgentAsyncObligationService,
  type AgentAsyncObligationRepository,
  type AsyncObligationNotice,
} from "../../../src/domains/agents/agent-async-obligation.service.js";

const now = "2026-01-01T00:00:00.000Z";

function obligation(
  state: AgentAsyncObligation["state"] = "ready",
): AgentAsyncObligation {
  return {
    id: "promoted_task:task_test:0",
    conversationId: "conv_test",
    ownerAgentId: "agent_test",
    sourceKind: "promoted_task",
    sourceId: "task_test",
    state,
    notificationEntryId: "entry_notice",
    generation: 0,
    outcome: "completed",
    createdAt: now,
    updatedAt: now,
    ...(state === "delivered" ? { deliveredAt: now } : {}),
  };
}

function setup() {
  const records = new Map([[obligation().id, obligation()]]);
  const entries: ConversationEntry[] = [];
  const enqueued: string[] = [];
  const cancelled: string[] = [];
  let allowed = true;
  const wakeCount = 0;
  const repository: AgentAsyncObligationRepository = {
    register: async (record) => {
      const existing = records.get(record.id);
      if (existing) return existing;
      records.set(record.id, record);
      return record;
    },
    get: async (id) => records.get(id),
    listByStates: async (states) =>
      [...records.values()].filter((record) => states.includes(record.state)),
    transition: async (id, expected, patch) => {
      const current = records.get(id)!;
      assert.ok(expected.includes(current.state));
      const replacement = { ...current, ...patch };
      records.set(id, replacement);
      return replacement;
    },
  };
  const notice: AsyncObligationNotice = {
    entry: {
      id: "entry_notice",
      conversationId: "conv_test",
      agentId: "agent_test",
      role: "system",
      kind: "task_event",
      text: "Task completed.",
      createdAt: now,
    },
    message: { role: "user", content: "Task completed." } as never,
  };
  const service = new AgentAsyncObligationService({
    repository,
    adapters: [
      {
        kind: "promoted_task",
        allow: async () => allowed,
        buildNotice: async () => notice,
      },
    ],
    getAgent: () => ({ id: "agent_test" }) as AgentRecord,
    entries: async () => entries,
    acceptNotice: async (record) => {
      enqueued.push(record.id);
      return "input_notice";
    },
    cancelNotice: async (_agentId, inputId) => {
      cancelled.push(inputId);
    },
    now: () => now,
  });
  service.start();
  return {
    service,
    records,
    entries,
    enqueued,
    cancelled,
    setAllowed: (value: boolean) => {
      allowed = value;
    },
    wakeCount: () => wakeCount,
    notice,
  };
}

describe("AgentAsyncObligationService", () => {
  it("accepts once through the durable queue and waits for transcript evidence", async () => {
    const fixture = setup();
    await fixture.service.recover();
    await fixture.service.recover();
    assert.deepEqual(fixture.enqueued, [obligation().id]);
    assert.equal(fixture.records.get(obligation().id)?.state, "ready");
    assert.equal(
      fixture.records.get(obligation().id)?.queueInputId,
      "input_notice",
    );
    await fixture.service.stop();
  });

  it("does not append idle notices or independently wake the owner", async () => {
    const fixture = setup();
    await fixture.service.recover();
    assert.equal(fixture.entries.length, 0);
    assert.equal(fixture.records.get(obligation().id)?.state, "ready");
    assert.equal(fixture.wakeCount(), 0);
    await fixture.service.stop();
  });

  it("cancels queued stale completion input when team generation policy suppresses it", async () => {
    const fixture = setup();
    await fixture.service.recover();
    fixture.setAllowed(false);
    await fixture.service.recover();
    assert.deepEqual(fixture.cancelled, ["input_notice"]);
    assert.equal(fixture.records.get(obligation().id)?.state, "suppressed");
    assert.equal(fixture.wakeCount(), 0);
    await fixture.service.stop();
  });

  it("marks delivered work consumed after an assistant descendant", async () => {
    const fixture = setup();
    fixture.records.set(obligation().id, {
      ...obligation("delivered"),
      queueInputId: "input_notice",
    });
    fixture.entries.push(
      {
        ...fixture.notice.entry,
        id: "entry_input_notice",
      } as ConversationEntry,
      {
        id: "entry_response",
        conversationId: "conv_test",
        agentId: "agent_test",
        parentEntryId: "entry_input_notice",
        role: "assistant",
        kind: "message",
        text: "Handled.",
        createdAt: now,
      } as ConversationEntry,
    );
    await fixture.service.recover();
    assert.equal(fixture.records.get(obligation().id)?.state, "consumed");
    assert.equal(fixture.wakeCount(), 0);
    await fixture.service.stop();
  });
});
