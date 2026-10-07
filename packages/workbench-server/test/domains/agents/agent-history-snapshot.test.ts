import assert from "node:assert/strict";
import { it } from "node:test";
import type { AgentRecord } from "@nervekit/contracts/agents";
import {
  SubagentTranscriptService,
  type SubagentTranscriptServiceDeps,
} from "../../../src/domains/agents/subagent-transcript.service.js";

it("hydrates complete scoped tool history, immutable outcome and adopted effective configuration at one cursor", async () => {
  const now = "2026-10-06T00:00:00.000Z";
  const agent = {
    id: "agent_child",
    conversationId: "conv_shared",
    contextOwnerAgentId: "agent_child",
    effectiveConfigurationRevision: 1,
  } as AgentRecord;
  const configuration = {
    mode: "coding",
    permissionLevel: "read_only",
    permissionRuleSetId: "read_only",
    projectDir: "/tmp",
    workspaceScope: { roots: ["/tmp"] },
    model: { provider: "original", modelId: "used" },
    thinkingLevel: "off",
    systemPrompt: "original",
    tools: ["read"],
    skills: [],
  };
  const effective = {
    agentId: agent.id,
    runId: "run_original",
    attemptId: "exec_original",
    turnId: "turn_original",
    configurationRevision: 1,
    configurationProvenance: "resolved",
    acceptedConfiguration: configuration,
    configuration,
  };
  const original = {
    agentId: agent.id,
    runId: "run_original",
    attemptId: "exec_original",
    outcome: "completed",
    completedAt: now,
    response: {
      entryId: "entry_original",
      runId: "run_original",
      text: "immutable original result",
      complete: true,
    },
  };
  let pages = 0;
  const service = new SubagentTranscriptService({
    getAgent: () => agent,
    harnessStorage: { modelEntries: async () => [] },
    events: {
      withCursor: async (_stream: string, read: () => Promise<unknown>) => ({
        value: await read(),
        cursor: { processedSeq: 42 },
      }),
    },
    storage: {
      canonicalStore: {
        readConversationEntries: async () => [],
        listDocuments: async () => [
          { data: effective, updatedAt: now },
          {
            data: { ...effective, configurationRevision: 2 },
            updatedAt: "2026-10-06T00:00:01.000Z",
          },
        ],
      },
    },
    tools: {
      queryToolCallPreviews: async () => {
        pages++;
        return {
          toolCalls: [{ id: `tool_${pages}` }],
          nextCursor:
            pages === 1 ? { id: "tool_1", updatedAt: now } : undefined,
        };
      },
      getToolCallDetails: async (id: string) => ({
        id,
        agentId: agent.id,
        conversationId: agent.conversationId,
        projectId: "proj_test",
        toolName: "read",
        risk: "read",
        args: { path: "file" },
        cwd: "/tmp",
        status: "completed",
        revision: 1,
        attempt: 1,
        interactions: [],
        createdAt: now,
        updatedAt: now,
        settledAt: now,
      }),
    },
    turnConfigurations: async () => [effective],
    latestCompletion: async () => original,
    activeRun: () => undefined,
    activityForAgent: async () => ({
      agentId: agent.id,
      state: "idle",
      conversationId: agent.conversationId,
      pendingInteractionCount: 0,
      pendingAsyncCount: 0,
      updatedAt: now,
    }),
  } as unknown as SubagentTranscriptServiceDeps);
  const snapshot = await service.snapshot(agent.id);
  assert.equal(snapshot.cursorSeq, 42);
  assert.equal(snapshot.agentId, agent.id);
  assert.equal(snapshot.toolCalls.length, 2);
  assert.equal(
    snapshot.latestCompletion?.response?.text,
    "immutable original result",
  );
  assert.equal(snapshot.effectiveConfiguration?.configurationRevision, 1);
  assert.equal(
    snapshot.effectiveConfiguration?.configuration.model?.modelId,
    "used",
  );
});
