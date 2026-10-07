import assert from "node:assert/strict";
import { it } from "node:test";
import { buildConversationContext } from "@nervekit/harness/conversation";
import type { AgentRecord } from "@nervekit/contracts/agents";
import { AutoCompactionRunner } from "../../../src/domains/agents/execution/auto-compaction-runner.js";

it("uses the selected model context window for threshold compaction", async () => {
  const active = agentRecord(
    "agent_active_large_window",
    "openai",
    "gpt-5.6-sol",
  );
  const selected = {
    ...agentRecord("agent_selected_small_window", "xai", "grok-4.5"),
    executionKind: "async_developer" as const,
  };
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
        api: "openai-responses",
        provider: "xai",
        model: "grok-4.5",
        usage: {
          input: 450_000,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 450_000,
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
  const settings = {
    compaction: {
      auto: true,
      profile: "balanced",
      customTriggerPercent: 80,
      customKeepRecentPercent: 15,
    },
    asyncSubagent: {
      compactionProfile: "aggressive",
      customTriggerPercent: 80,
      customKeepRecentPercent: 15,
    },
  };
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
    storage: { settings },
    capabilities: { settings: async () => settings },
    harnessStorage: {
      openStorage: async () => ({
        getLeafId: async () => "entry_context_usage",
        getPathToRoot: async () => branch,
        getContextPath: async () => branch,
        buildContext: async () => buildConversationContext(branch as never),
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
    getContextBranch: async () => branch,
    buildContext: async () => buildConversationContext(branch as never),
  };
  await runner.maybeCompactAtIteration({
    conversationId: selected.conversationId,
    agentId: selected.id,
    runId: "run_selected",
    conversation: activeConversation as never,
  });
  assert.equal(compactions.length, 1);
  assert.equal(compactions[0]?.agentId, selected.id);
  assert.equal(compactions[0]?.contextWindow, 500_000);
  // Common execution uses the shared balanced settings, not legacy-kind overrides.
  assert.equal(compactions[0]?.thresholdTokens, 400_000);
  assert.equal(compactions[0]?.keepRecentTokens, 75_000);
  assert.equal(compactions[0]?.activeConversation, activeConversation);
});

it("compacts projected prompt usage before the first provider iteration", async () => {
  const agent = agentRecord("agent_preflight", "xai", "grok-4.5");
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
        api: "openai-responses",
        provider: "xai",
        model: "grok-4.5",
        usage: {
          input: 400_000,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 400_000,
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
  const settings = {
    compaction: {
      auto: true,
      profile: "balanced",
      customTriggerPercent: 80,
      customKeepRecentPercent: 15,
    },
    asyncSubagent: {
      compactionProfile: "inherit",
      customTriggerPercent: 80,
      customKeepRecentPercent: 15,
    },
  };
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
    storage: { settings },
    capabilities: { settings: async () => settings },
    harnessStorage: {
      openStorage: async () => ({
        getLeafId: async () => "entry_preflight_usage",
        getPathToRoot: async () => branch,
        getContextPath: async () => branch,
        buildContext: async () => buildConversationContext(branch as never),
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

  assert.deepEqual(
    await runner.maybeCompactBeforePrompt({
      conversationId: agent.conversationId,
      agentId: agent.id,
      runId: "run_preflight",
      text: "x".repeat(20_000),
      conversation: {
        getBranch: async () => branch,
        getContextBranch: async () => branch,
        buildContext: async () => buildConversationContext(branch as never),
      } as never,
    }),
    { status: "compacted", reason: "checkpoint_committed" },
  );
  assert.equal(compactions.length, 1);
  assert.equal(compactions[0]?.contextTokens, 405_000);
});

it("publishes executing-owner usage while keeping default queries root-scoped", async () => {
  const lead = agentRecord("lead", "openai", "gpt-5.6-sol");
  const child = {
    ...agentRecord("child", "xai", "grok-4.5"),
    executionKind: "async_developer",
  };
  const calls: string[] = [];
  const events: Array<{
    agentId: string;
    contextUsage: { tokens: number | null; contextWindow: number };
  }> = [];
  const branch = (text: string) => [
    {
      type: "message",
      id: text,
      parentId: null,
      timestamp: "2026-07-18T00:00:00.000Z",
      message: { role: "user", content: text, timestamp: 0 },
    },
  ];
  const rootBranch = branch("root".repeat(100));
  let childBranch: unknown[] = branch("child".repeat(1000));
  const storage = (entries: unknown[]) => ({
    getContextPath: async () => entries,
    buildContext: async () => buildConversationContext(entries as never),
  });
  const runner = new AutoCompactionRunner({
    state: {
      getConversation: () => ({
        id: lead.conversationId,
        activeAgentId: lead.id,
      }),
      agents: new Map([
        [lead.id, lead],
        [child.id, child],
      ]),
    },
    harnessStorage: {
      openStorage: async () => {
        calls.push("root");
        return storage(rootBranch);
      },
      openAgentStorage: async (agent: AgentRecord) => {
        calls.push(agent.id);
        return storage(agent.id === child.id ? childBranch : rootBranch);
      },
    },
    events: {
      publish: async (_type: string, data: (typeof events)[number]) => {
        events.push(data);
      },
    },
  } as never);
  const root = await runner.getContextUsage(lead.conversationId);
  await runner.publishContextUsage(child.conversationId, child.id, "child-run");
  await runner.publishContextUsage(lead.conversationId, lead.id, "lead-run");
  assert.deepEqual(calls, ["root", "child", "lead"]);
  assert.equal(events[0]?.agentId, child.id);
  assert.equal(events[0]?.contextUsage.contextWindow, 500_000);
  assert.ok(events[0]!.contextUsage.tokens! > root.tokens!);
  assert.notEqual(events[0]?.contextUsage.contextWindow, root.contextWindow);
  assert.deepEqual(events[1]?.contextUsage, root);

  childBranch = [
    ...childBranch,
    {
      type: "compaction",
      id: "checkpoint",
      parentId: null,
      timestamp: "2026-07-18T00:00:01.000Z",
      summary: "summary",
      firstKeptEntryId: childBranch[0] && (childBranch[0] as { id: string }).id,
      tokensBefore: 1000,
    },
  ];
  await runner.publishContextUsage(child.conversationId, child.id, "child-run");
  assert.deepEqual(events[2]?.contextUsage, {
    tokens: null,
    percent: null,
    contextWindow: 500_000,
  });
  await assert.rejects(
    runner.publishContextUsage(lead.conversationId, "missing", "run"),
    /does not belong/,
  );
  await assert.rejects(
    runner.publishContextUsage("another-conversation", child.id, "run"),
    /does not belong/,
  );
  assert.equal(events.length, 3);
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
    mode: "coding",
    permissionLevel: "supervised",
    workspaceScope: "project",
    model: { provider, modelId },
    thinkingLevel: "off",
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
  } as AgentRecord;
}
