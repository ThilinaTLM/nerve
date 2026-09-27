import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AgentAsyncObligation,
  AgentRecord,
} from "@nervekit/contracts/agents";
import type { ConversationRecord } from "@nervekit/contracts/conversations";
import type { RunRecord } from "@nervekit/contracts/runs";
import {
  AgentActivityService,
  type AgentActivityServicePorts,
} from "../../../src/domains/agents/agent-activity.service.js";
import type { RunHydratedState } from "../../../src/domains/runs/runtime/index.js";

const now = "2026-01-01T00:00:00.000Z";

function agent(): AgentRecord {
  return {
    id: "agent_test",
    conversationId: "conv_test",
    projectId: "proj_test",
    projectDir: "/tmp/project",
    rootAgentId: "agent_test",
    mode: "coding",
    permissionLevel: "autonomous",
    workspaceScope: { roots: ["/tmp/project"] },
    budget: { depth: 0, maxDepth: 3 },
    thinkingLevel: "off",
    createdAt: now,
    updatedAt: now,
  };
}

function conversation(
  changes: Partial<ConversationRecord> = {},
): ConversationRecord {
  return {
    id: "conv_test",
    projectId: "proj_test",
    title: "Test",
    mode: "coding",
    permissionLevel: "autonomous",
    activeAgentId: "agent_test",
    createdAt: now,
    updatedAt: now,
    ...changes,
  };
}

function run(
  status: RunRecord["status"],
  changes: Partial<RunRecord> = {},
): RunRecord {
  return {
    stateEpoch: 1,
    conversationId: "conv_test",
    agentId: "agent_test",
    projectId: "proj_test",
    runId: "run_test",
    scopeId: "conv_test:agent_test",
    revision: 1,
    status,
    recoverability: "not_needed",
    executionId: "exec_test",
    attempt: 1,
    createdAt: now,
    updatedAt: now,
    cancellationEvidence: [],
    ...changes,
  };
}

function hydrated(
  status: RunRecord["status"],
  pendingInteractions = 0,
): RunHydratedState {
  return {
    run: run(status),
    prompts: [],
    checkpoints: [],
    transitions: [],
    deliveries: [],
    interactions: Array.from({ length: pendingInteractions }, (_, index) => ({
      id: `interaction_${index}`,
      status: "pending",
    })) as RunHydratedState["interactions"],
  };
}

function obligation(
  state: AgentAsyncObligation["state"] = "pending",
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
    createdAt: now,
    updatedAt: now,
    ...(state === "delivered" ? { deliveredAt: now } : {}),
  };
}

function service(input: {
  active?: RunHydratedState;
  latest?: RunRecord;
  obligations?: AgentAsyncObligation[];
  conversation?: ConversationRecord;
}) {
  const ports: AgentActivityServicePorts = {
    listAgents: () => [agent()],
    listConversations: () => [input.conversation ?? conversation()],
    listActiveRuns: async () => (input.active ? [input.active] : []),
    listRunMetadata: async () => (input.latest ? [input.latest] : []),
    listObligations: async () => input.obligations ?? [],
  };
  return new AgentActivityService(ports);
}

describe("AgentActivityService", () => {
  it("projects active and interaction states with deterministic precedence", async () => {
    assert.equal(
      (
        await service({ active: hydrated("running") }).activityForAgent(
          "agent_test",
        )
      ).state,
      "running",
    );
    const awaiting = await service({
      active: hydrated("waiting", 2),
    }).activityForAgent("agent_test");
    assert.equal(awaiting.state, "awaiting_user");
    assert.equal(awaiting.pendingInteractionCount, 2);
    assert.equal(awaiting.activeRunId, "run_test");
  });

  it("surfaces a waiting run without a pending interaction as error", async () => {
    const activity = await service({
      active: hydrated("waiting"),
    }).activityForAgent("agent_test");
    assert.equal(activity.state, "error");
  });

  it("projects unconsumed obligations as awaiting_async only while idle", async () => {
    const idle = await service({
      obligations: [obligation("pending"), obligation("delivered")],
    }).activityForAgent("agent_test");
    assert.equal(idle.state, "awaiting_async");
    assert.equal(idle.pendingAsyncCount, 2);

    const running = await service({
      active: hydrated("running"),
      obligations: [obligation()],
    }).activityForAgent("agent_test");
    assert.equal(running.state, "running");
    assert.equal(running.pendingAsyncCount, 1);
  });

  it("honors failure clearing, cancellation, and conversation completion", async () => {
    const failed = run("failed", {
      failure: {
        category: "server",
        code: "TEST",
        message: "failed",
        retryable: false,
      },
    });
    assert.equal(
      (await service({ latest: failed }).activityForAgent("agent_test")).state,
      "error",
    );
    const clearedConversation = conversation({
      runtimeStatusClearedAt: "2026-01-01T00:01:00.000Z",
      completedAt: "2026-01-01T00:02:00.000Z",
      // Metadata-only state updates deliberately preserve list activity time.
      updatedAt: now,
    });
    const cleared = service({
      latest: failed,
      conversation: clearedConversation,
    });
    const clearedAgent = await cleared.activityForAgent("agent_test");
    assert.equal(clearedAgent.state, "idle");
    assert.equal(clearedAgent.updatedAt, "2026-01-01T00:01:00.000Z");
    assert.equal(
      (await cleared.activityForConversation("conv_test")).state,
      "completed",
    );
    assert.equal(
      (
        await service({
          latest: run("cancelled"),
          conversation: clearedConversation,
        }).activityForConversation("conv_test")
      ).state,
      "completed",
    );
    assert.equal(
      (
        await service({ latest: run("cancelled") }).activityForAgent(
          "agent_test",
        )
      ).state,
      "aborted",
    );
  });
});
