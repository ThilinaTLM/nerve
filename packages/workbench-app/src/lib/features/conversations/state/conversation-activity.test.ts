import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AgentRecord,
  ApprovalWithToolCall,
  ConversationRecord,
  PlanReviewRecord,
  UserQuestionRecord,
} from "$lib/api";
import type { ConversationViewState } from "$lib/core/types/state-types";
import {
  buildConversationActivityById,
  conversationActivityForRecord,
} from "./conversation-activity";

const now = "2026-01-01T00:00:00.000Z";

function conversation(
  overrides: Partial<ConversationRecord> = {},
): ConversationRecord {
  return {
    id: "conv_01H00000000000000000000000",
    projectId: "proj_01H0000000000000000000000",
    title: "Test conversation",
    mode: "coding",
    permissionLevel: "autonomous",
    approvalPolicy: { autoApproveReadOnly: true },
    activeAgentId: "agent_01H00000000000000000000000",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function agent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "agent_01H00000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    projectId: "proj_01H0000000000000000000000",
    projectDir: "/tmp/project",
    rootAgentId: "agent_01H00000000000000000000000",
    mode: "coding",
    permissionLevel: "autonomous",
    approvalPolicy: { autoApproveReadOnly: true },
    workspaceScope: { roots: ["/tmp/project"] },
    budget: { depth: 0, maxDepth: 3, maxRuns: 8, usedRuns: 0 },
    thinkingLevel: "off",
    status: "idle",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function view(
  overrides: Partial<ConversationViewState> = {},
): ConversationViewState {
  return {
    conversationId: "conv_01H00000000000000000000000",
    activeEntryIds: [],
    entries: [],
    toolCalls: [],
    treeNodes: [],
    optimisticMessages: [],
    queuedPrompts: [],
    cursorSeq: 0,
    sending: false,
    stopping: false,
    composerText: "",
    loading: false,
    ...overrides,
  };
}

function approval(): ApprovalWithToolCall {
  return {
    id: "approval_01H000000000000000000000",
    toolCallId: "tool_01H0000000000000000000000",
    agentId: "agent_01H00000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    projectId: "proj_01H0000000000000000000000",
    risk: "interaction",
    reason: "Needs review",
    status: "pending",
    requestedAt: now,
  };
}

function question(): UserQuestionRecord {
  return {
    id: "question_01H00000000000000000000",
    toolCallId: "tool_01H0000000000000000000000",
    agentId: "agent_01H00000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    projectId: "proj_01H0000000000000000000000",
    question: "Continue?",
    status: "pending",
    requestedAt: now,
    updatedAt: now,
  };
}

function planReview(): PlanReviewRecord {
  return {
    id: "plan_review_01H000000000000000000",
    toolCallId: "tool_01H0000000000000000000000",
    agentId: "agent_01H00000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    projectId: "proj_01H0000000000000000000000",
    slug: "test-plan",
    planPath: "/tmp/plan.md",
    status: "pending",
    requestedAt: now,
    updatedAt: now,
  };
}

describe("conversation activity", () => {
  it("shows running from live conversation view before agent status catches up", () => {
    const activity = conversationActivityForRecord({
      conversationId: "conv_01H00000000000000000000000",
      agent: agent({ status: "idle" }),
      view: view({ sending: true }),
    });

    assert.equal(activity.tone, "running");
    assert.equal(activity.busy, true);
    assert.equal(activity.pulse, true);
  });

  it("keeps coding-mode running activity on the running tone", () => {
    const activity = conversationActivityForRecord({
      conversationId: "conv_01H00000000000000000000000",
      agent: agent({ status: "running", mode: "coding" }),
    });

    assert.equal(activity.tone, "running");
    assert.equal(activity.busy, true);
    assert.equal(activity.pulse, true);
  });

  it("uses the success tone for planning-mode live activity before agent status catches up", () => {
    const activity = conversationActivityForRecord({
      conversationId: "conv_01H00000000000000000000000",
      agent: agent({ status: "idle", mode: "planning" }),
      mode: "planning",
      view: view({ sending: true }),
    });

    assert.equal(activity.tone, "good");
    assert.equal(activity.busy, true);
    assert.equal(activity.pulse, true);
  });

  it("uses the success tone for running planning-mode agents", () => {
    const activity = conversationActivityForRecord({
      conversationId: "conv_01H00000000000000000000000",
      agent: agent({ status: "running", mode: "planning" }),
    });

    assert.equal(activity.tone, "good");
    assert.equal(activity.busy, true);
    assert.equal(activity.pulse, true);
  });

  it("keeps pending user input as warn for running planning-mode agents", () => {
    const activity = conversationActivityForRecord({
      conversationId: "conv_01H00000000000000000000000",
      agent: agent({ status: "running", mode: "planning" }),
      hasPendingHumanInput: true,
    });

    assert.equal(activity.tone, "warn");
    assert.equal(activity.needsUser, true);
    assert.equal(activity.source, "pending-input");
  });

  it("treats a waiting active run as user action despite stale running agent state", () => {
    const activity = conversationActivityForRecord({
      conversationId: "conv_01H00000000000000000000000",
      agent: agent({ status: "running" }),
      view: view({
        activeRun: {
          runId: "run_waiting",
          agentId: "agent_01H00000000000000000000000",
          projectId: "proj_01H0000000000000000000000",
          conversationId: "conv_01H00000000000000000000000",
          status: "waiting",
          startedAt: now,
          turns: [],
          toolOutputsByToolCallId: {},
          queuedPrompts: [],
        },
      }),
    });

    assert.equal(activity.label, "Needs user action");
    assert.equal(activity.busy, false);
    assert.equal(activity.pulse, false);
    assert.equal(activity.needsUser, true);
    assert.equal(activity.source, "live-view");
  });

  it("shows pending human input as warn even if agent status is stale", () => {
    const [record] = [conversation()];
    const activityById = buildConversationActivityById({
      conversations: [record],
      agents: [agent({ status: "idle" })],
      views: {},
      approvals: [approval()],
      userQuestions: [],
      planReviews: [],
    });

    assert.equal(activityById[record.id].tone, "warn");
    assert.equal(activityById[record.id].needsUser, true);
    assert.equal(activityById[record.id].source, "pending-input");
  });

  it("treats questions and plan reviews as the same pending activity source", () => {
    for (const pending of [
      { userQuestions: [question()], planReviews: [] },
      { userQuestions: [], planReviews: [planReview()] },
    ]) {
      const record = conversation();
      const activity = buildConversationActivityById({
        conversations: [record],
        agents: [agent()],
        views: {},
        approvals: [],
        ...pending,
      })[record.id];

      assert.equal(activity.tone, "warn");
      assert.equal(activity.label, "Needs user action");
    }
  });

  it("maps awaiting user and error agent states", () => {
    assert.equal(
      conversationActivityForRecord({
        conversationId: "conv_01H00000000000000000000000",
        agent: agent({ status: "awaiting_user" }),
      }).tone,
      "warn",
    );
    assert.equal(
      conversationActivityForRecord({
        conversationId: "conv_01H00000000000000000000000",
        agent: agent({ status: "error" }),
      }).tone,
      "danger",
    );
  });
});
