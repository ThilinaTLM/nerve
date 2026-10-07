import assert from "node:assert/strict";
import { it } from "node:test";
import type { AgentRecord } from "@nervekit/contracts/agents";
import {
  SubagentTranscriptService,
  type SubagentTranscriptServiceDeps,
} from "../../../src/domains/agents/subagent-transcript.service.js";

it("normal history isolates roots/children/siblings and preserves unowned legacy lead entries only for its bound owner", async () => {
  const ids = [
    "agent_root",
    "agent_child",
    "agent_sibling",
    "agent_additional_root",
  ];
  const records = ids.map(
    (id) =>
      ({
        id,
        conversationId: "conv_shared",
        contextOwnerAgentId: id === "agent_root" ? null : id,
      }) as AgentRecord,
  );
  const entries = [
    ...ids.map((agentId, index) => ({
      id: `entry_${index}`,
      agentId,
      conversationId: "conv_shared",
      text: agentId,
      role: "user",
      kind: "message",
      createdAt: "2026-10-06T00:00:00.000Z",
    })),
    {
      id: "entry_legacy",
      agentId: undefined,
      conversationId: "conv_shared",
      text: "Imported lead context",
      role: "user",
      kind: "message",
      createdAt: "2026-10-06T00:00:00.000Z",
    },
  ];
  const service = new SubagentTranscriptService({
    getAgent: (id: string) => {
      const agent = records.find((record) => record.id === id);
      if (!agent) throw new Error("Agent not found");
      return agent;
    },
    harnessStorage: { modelEntries: async () => [] },
    storage: {
      canonicalStore: { readConversationEntries: async () => entries },
    },
  } as unknown as SubagentTranscriptServiceDeps);
  for (const id of ids)
    assert.deepEqual(
      (await service.history(id)).map((entry) => entry.id),
      id === "agent_root"
        ? ["entry_0", "entry_legacy"]
        : [`entry_${ids.indexOf(id)}`],
    );
  await assert.rejects(service.history("agent_unknown"), /Agent not found/);
});
