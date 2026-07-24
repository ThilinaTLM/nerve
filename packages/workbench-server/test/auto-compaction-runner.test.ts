import assert from "node:assert/strict";
import { it } from "node:test";
import type { AgentRecord } from "@nervekit/contracts";
import { AutoCompactionRunner } from "../src/domains/agents/run/auto-compaction-runner.js";

it("uses the selected model context window for threshold compaction", async () => {
  const active = agentRecord(
    "agent_active_large_window",
    "openai",
    "gpt-5.6-sol",
  );
  const selected = agentRecord(
    "agent_selected_small_window",
    "xai",
    "grok-build-0.1",
  );
  const timestamp = "2026-07-18T00:00:00.000Z";
  const branch = [
    {
      type: "message",
      id: "entry_context_usage",
      parentId: null,
      timestamp,
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Approaching the selected model limit." },
        ],
        api: "openai-completions",
        provider: "xai",
        model: "grok-build-0.1",
        usage: {
          input: 240_000,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 240_000,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        },
        stopReason: "stop",
        timestamp: Date.parse(timestamp),
      },
    },
  ];
  const compactions: Array<Record<string, unknown>> = [];
  const agents = new Map([
    [active.id, active],
    [selected.id, selected],
  ]);
  const runner = new AutoCompactionRunner({
    state: {
      getConversation: () => ({
        id: selected.conversationId,
        projectId: selected.projectId,
        activeAgentId: active.id,
      }),
      getProject: () => ({ id: selected.projectId, dir: "/tmp/project" }),
      agents,
    },
    storage: {
      settings: {
        compaction: {
          auto: true,
          profile: "balanced",
          customTriggerPercent: 80,
          customKeepRecentPercent: 15,
        },
      },
    },
    harnessStorage: {
      openStorage: async () => ({
        getLeafId: async () => "entry_context_usage",
        getPathToRoot: async () => branch,
      }),
    },
    compactionService: {
      compactConversation: async (
        _conversationId: string,
        _request: unknown,
        options: Record<string, unknown>,
      ) => {
        compactions.push(options);
      },
    },
    logger: { warn: async () => undefined },
  } as never);

  const activeConversation = {
    getBranch: async () => branch,
  };
  await runner.maybeCompactAtIteration({
    conversationId: selected.conversationId,
    agentId: selected.id,
    runId: "run_selected",
    conversation: activeConversation as never,
  });
  assert.equal(compactions.length, 1);
  assert.equal(compactions[0]?.agentId, selected.id);
  assert.equal(compactions[0]?.contextWindow, 256_000);
  assert.equal(compactions[0]?.thresholdTokens, 204_800);
  assert.equal(compactions[0]?.keepRecentTokens, 38_400);
  assert.equal(compactions[0]?.activeConversation, activeConversation);
});

it("compacts projected prompt usage before the first provider iteration", async () => {
  const agent = agentRecord("agent_preflight", "xai", "grok-build-0.1");
  const timestamp = "2026-07-18T00:00:00.000Z";
  const branch = [
    {
      type: "message",
      id: "entry_preflight_usage",
      parentId: null,
      timestamp,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Near the balanced threshold." }],
        api: "openai-completions",
        provider: "xai",
        model: "grok-build-0.1",
        usage: {
          input: 200_000,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 200_000,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        },
        stopReason: "stop",
        timestamp: Date.parse(timestamp),
      },
    },
  ];
  const compactions: Array<Record<string, unknown>> = [];
  const runner = new AutoCompactionRunner({
    state: {
      getConversation: () => ({
        id: agent.conversationId,
        projectId: agent.projectId,
        activeAgentId: agent.id,
      }),
      getProject: () => ({ id: agent.projectId, dir: "/tmp/project" }),
      agents: new Map([[agent.id, agent]]),
    },
    storage: {
      settings: {
        compaction: {
          auto: true,
          profile: "balanced",
          customTriggerPercent: 80,
          customKeepRecentPercent: 15,
        },
      },
    },
    harnessStorage: {
      openStorage: async () => ({
        getLeafId: async () => "entry_preflight_usage",
        getPathToRoot: async () => branch,
      }),
    },
    compactionService: {
      compactConversation: async (
        _conversationId: string,
        _request: unknown,
        options: Record<string, unknown>,
      ) => {
        compactions.push(options);
      },
    },
    logger: { warn: async () => undefined },
  } as never);

  assert.equal(
    await runner.maybeCompactBeforePrompt({
      conversationId: agent.conversationId,
      agentId: agent.id,
      runId: "run_preflight",
      text: "x".repeat(20_000),
      conversation: { getBranch: async () => branch } as never,
    }),
    true,
  );
  assert.equal(compactions.length, 1);
  assert.equal(compactions[0]?.contextTokens, 205_000);
});

function agentRecord(
  id: string,
  provider: string,
  modelId: string,
): AgentRecord {
  return {
    id,
    conversationId: "conv_regression",
    projectId: "proj_regression",
    projectDir: "/tmp/project",
    workerId: "worker_regression",
    status: "idle",
    mode: "coding",
    permissionLevel: "supervised",
    approvalPolicy: {
      autoApproveReadOnly: true,
      allowReadOnlyWithoutPrompt: true,
    },
    workspaceScope: "project",
    model: { provider, modelId },
    thinkingLevel: "off",
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
  } as AgentRecord;
}
