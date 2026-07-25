import type { AgentRecord, ConversationRecord } from "$lib/api";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mainAgentForConversation } from "./main-agent";

function agent(id: string, overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id,
    conversationId: "conv_1",
    rootAgentId: id,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as AgentRecord;
}

const conversation = {
  id: "conv_1",
  activeAgentId: "agent_child",
} as ConversationRecord;

describe("main agent resolution", () => {
  it("never falls back to a sub-agent when the active reference is invalid", () => {
    const root = agent("agent_root");
    const unrelatedChild = agent("agent_child", {
      conversationId: "conv_other",
      parentAgentId: "agent_other_root",
      rootAgentId: "agent_other_root",
    });

    assert.equal(
      mainAgentForConversation(conversation, [unrelatedChild, root])?.id,
      root.id,
    );
  });
});
