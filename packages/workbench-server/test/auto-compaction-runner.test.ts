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
  const continuations: string[] = [];
  const agents = new Map([
    [active.id, active],
    [selected.id, selected],
  ]);
  const runner = new AutoCompactionRunner(
    {
      state: {
        getConversation: () => ({
          id: selected.conversationId,
          projectId: selected.projectId,
          activeAgentId: active.id,
        }),
        getProject: () => ({ id: selected.projectId, dir: "/tmp/project" }),
        agents,
      },
      storage: { settings: { compaction: { auto: true } } },
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
    } as never,
    new Map(),
    async (agent) => {
      continuations.push(agent.id);
    },
  );

  await runner.maybeAutoCompact(
    selected.conversationId,
    selected.id,
    "run_selected",
  );
  assert.equal(compactions.length, 1);
  assert.equal(compactions[0]?.agentId, selected.id);
  assert.equal(compactions[0]?.contextWindow, 256_000);
  assert.equal(compactions[0]?.thresholdTokens, 230_400);
  assert.deepEqual(continuations, [selected.id]);

  await runner.maybeAutoCompact(selected.conversationId);
  assert.equal(
    compactions.length,
    1,
    "the active model's larger window should remain below threshold",
  );
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
