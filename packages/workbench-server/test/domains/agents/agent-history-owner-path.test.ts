import assert from "node:assert/strict";
import { it } from "node:test";
import {
  agentHistoryResultSchema,
  type AgentRecord,
} from "@nervekit/contracts/agents";
import {
  SubagentTranscriptService,
  type SubagentTranscriptServiceDeps,
} from "../../../src/domains/agents/subagent-transcript.service.js";

it("returns true owner leaf ancestry, frozen compaction/tool prefix, and model-only prefix before newer detached history", async () => {
  const agent = {
    id: "agent_secondary",
    conversationId: "conv_shared",
    contextOwnerAgentId: "agent_secondary",
  } as AgentRecord;
  const time = (day: number) => `2026-10-0${day}T00:00:00.000Z`;
  const frozenTool = {
    id: "tool_original",
    agentId: "agent_lead",
    conversationId: agent.conversationId,
    projectId: "proj_test",
    toolName: "read",
    risk: "read",
    args: { path: "old" },
    cwd: "/tmp",
    status: "completed",
    revision: 1,
    attempt: 1,
    interactions: [],
    createdAt: time(1),
    updatedAt: time(1),
    settledAt: time(1),
    result: { text: "frozen output" },
  };
  const model = [
    {
      id: "entry_prefix",
      parentId: null,
      type: "message",
      timestamp: time(1),
      message: { role: "user", content: "original prefix", timestamp: 1 },
    },
    {
      id: "entry_compaction",
      parentId: "entry_prefix",
      type: "compaction",
      timestamp: time(2),
      summary: "FROZEN summary",
      tokensBefore: 100,
      firstKeptEntryId: "entry_prefix",
    },
    {
      id: "entry_tool",
      parentId: "entry_compaction",
      type: "message",
      timestamp: time(3),
      message: {
        role: "toolResult",
        toolCallId: "provider_original",
        toolName: "read",
        content: [{ type: "text", text: "FROZEN output" }],
        details: { toolCall: frozenTool },
        isError: false,
        timestamp: 3,
      },
    },
    {
      id: "entry_leaf",
      parentId: "entry_tool",
      type: "message",
      timestamp: time(4),
      message: { role: "user", content: "selected branch", timestamp: 4 },
    },
    {
      id: "entry_detached",
      parentId: "entry_prefix",
      type: "message",
      timestamp: time(5),
      message: { role: "user", content: "newer detached branch", timestamp: 5 },
    },
  ];
  model.push({
    id: "entry_model_tool",
    parentId: "entry_prefix",
    type: "message",
    timestamp: time(3),
    message: {
      role: "toolResult",
      toolCallId: "provider_model",
      toolName: "read",
      content: [{ type: "text", text: "MODEL ONLY frozen output" }],
      details: { toolCall: { ...frozenTool, id: "tool_model_original" } },
      isError: false,
      timestamp: 3,
    },
  });
  const service = new SubagentTranscriptService({
    getAgent: () => agent,
    harnessStorage: {
      modelEntries: async () => model,
      openAgentStorage: async () => ({ getLeafId: async () => "entry_leaf" }),
    },
    storage: {
      canonicalStore: {
        readConversationEntries: async () => [
          {
            id: "entry_compaction",
            conversationId: agent.conversationId,
            agentId: "agent_lead",
            role: "system",
            kind: "compaction",
            text: "FUTURE changed summary",
            createdAt: time(2),
          },
          {
            id: "entry_tool",
            conversationId: agent.conversationId,
            agentId: "agent_lead",
            role: "system",
            kind: "tool_result",
            text: "FUTURE sibling output",
            details: {
              toolCall: { ...frozenTool, result: { text: "FUTURE secret" } },
            },
            createdAt: time(3),
          },
          {
            id: "entry_sibling_future",
            conversationId: agent.conversationId,
            agentId: "agent_lead",
            role: "user",
            kind: "message",
            text: "FUTURE sibling message",
            createdAt: time(6),
          },
        ],
      },
    },
    tools: {
      queryToolCallPreviews: async () => ({ toolCalls: [] }),
      getToolCallDetails: async () => {
        throw new Error("Must not fetch live foreign prefix tools");
      },
    },
    events: {
      withCursor: async (_stream: string, read: () => Promise<unknown>) => ({
        value: await read(),
        cursor: { processedSeq: 12 },
      }),
    },
    latestCompletion: async () => null,
    turnConfigurations: async () => [],
    activeRun: () => undefined,
    activityForAgent: async () => ({
      agentId: agent.id,
      state: "idle",
      conversationId: agent.conversationId,
      pendingInteractionCount: 0,
      pendingAsyncCount: 0,
      updatedAt: time(6),
    }),
  } as unknown as SubagentTranscriptServiceDeps);
  const result = await service.snapshot(agent.id);
  assert.equal(result.activeEntryId, "entry_leaf");
  assert.deepEqual(result.activeEntryIds, [
    "entry_prefix",
    "entry_compaction",
    "entry_tool",
    "entry_leaf",
  ]);
  assert.equal(result.entries[0]?.id, "entry_prefix");
  assert.equal(result.entries.at(-1)?.id, "entry_detached");
  assert.equal(
    result.entries.find((entry) => entry.id === "entry_compaction")?.text,
    "FROZEN summary",
  );
  assert.equal(
    result.entries.find((entry) => entry.id === "entry_tool")?.text,
    "FROZEN output",
  );
  assert.equal(result.toolCalls[0]?.result?.text, "frozen output");
  assert.equal(result.toolCalls[0]?.agentId, "agent_lead");
  assert.equal(
    result.entries.find((entry) => entry.id === "entry_model_tool")?.text,
    "MODEL ONLY frozen output",
  );
  assert.ok(
    result.toolCalls.some((record) => record.id === "tool_model_original"),
  );
  assert.ok(!JSON.stringify(result).includes("FUTURE"));
  assert.equal(agentHistoryResultSchema.parse(result).cursorSeq, 12);
});
