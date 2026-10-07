import assert from "node:assert/strict";
import { it } from "node:test";
import type { AgentRecord } from "@nervekit/contracts/agents";
import {
  SubagentTranscriptService,
  type SubagentTranscriptServiceDeps,
} from "../../../src/domains/agents/subagent-transcript.service.js";

it("preserves a frozen owned migration prefix without following later sibling history", async () => {
  const agent = {
    id: "agent_secondary",
    conversationId: "conv_shared",
    contextOwnerAgentId: "agent_secondary",
  } as AgentRecord;
  const canonical = [
    {
      id: "entry_old",
      conversationId: agent.conversationId,
      agentId: "agent_lead",
      role: "user",
      kind: "message",
      text: "frozen prefix",
      createdAt: "2026-10-06T00:00:00.000Z",
    },
    {
      id: "entry_future",
      conversationId: agent.conversationId,
      agentId: "agent_lead",
      role: "assistant",
      kind: "message",
      text: "future sibling secret",
      createdAt: "2026-10-06T00:00:01.000Z",
    },
  ];
  const service = new SubagentTranscriptService({
    getAgent: () => agent,
    storage: {
      canonicalStore: { readConversationEntries: async () => canonical },
    },
    harnessStorage: {
      modelEntries: async (_conversationId: string, ownerId: string) => {
        assert.equal(ownerId, agent.id);
        return [
          {
            id: "entry_old",
            type: "message",
            parentId: null,
            timestamp: canonical[0]!.createdAt,
            message: {
              role: "user",
              content: [{ type: "text", text: "frozen prefix" }],
              timestamp: 0,
            },
          },
        ];
      },
    },
  } as unknown as SubagentTranscriptServiceDeps);
  const history = await service.history(agent.id);
  assert.deepEqual(
    history.map((entry) => entry.id),
    ["entry_old"],
  );
  assert.equal(history[0]!.agentId, agent.id);
  assert.equal(
    (history[0]!.details as { sourceAgentId: string }).sourceAgentId,
    "agent_lead",
  );
  assert.doesNotMatch(JSON.stringify(history), /future sibling secret/);
});
