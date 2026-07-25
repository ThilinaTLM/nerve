import type {
  AgentRecord,
  ConversationRecord,
  PlanReviewRecord,
  ToolCallRecord,
  UserQuestionRecord,
} from "$lib/api";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createInteractionActions,
  type InteractionActionDeps,
} from "./interaction-actions";

function planReview(
  overrides: Partial<PlanReviewRecord> = {},
): PlanReviewRecord {
  return {
    id: "review_1",
    status: "accepted",
    agentId: "agent_1",
    conversationId: "conv_1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as PlanReviewRecord;
}

function question(
  overrides: Partial<UserQuestionRecord> = {},
): UserQuestionRecord {
  return {
    id: "question_1",
    status: "answered",
    conversationId: "conv_1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as UserQuestionRecord;
}

function fixture(overrides: {
  requests?: Partial<InteractionActionDeps["requests"]>;
}) {
  const calls: string[] = [];
  const notifications: Array<{ kind: string; title: string }> = [];
  const reconciled: Array<{ op: string; id: string }> = [];
  const record =
    <T>(name: string, result: T) =>
    async (): Promise<T> => {
      calls.push(name);
      return result;
    };
  const deps: InteractionActionDeps = {
    requests: {
      grantApproval: record("grantApproval", {} as ToolCallRecord),
      denyApproval: record("denyApproval", {} as ToolCallRecord),
      acceptPlanReview: record("acceptPlanReview", planReview()),
      acceptPlanReviewInNewChat: record("acceptPlanReviewInNewChat", {
        planReview: planReview({ status: "accepted" }),
        conversation: { id: "conv_new" } as ConversationRecord,
        agent: { id: "agent_new" } as AgentRecord,
      }),
      rejectPlanReview: record(
        "rejectPlanReview",
        planReview({ status: "changes_requested" }),
      ),
      requestPlanChanges: record(
        "requestPlanChanges",
        planReview({ status: "changes_requested" }),
      ),
      discardPlanReview: record(
        "discardPlanReview",
        planReview({ status: "discarded" }),
      ),
      answerUserQuestion: record("answerUserQuestion", question()),
      dismissUserQuestion: record(
        "dismissUserQuestion",
        question({ status: "dismissed" }),
      ),
      ...overrides.requests,
    },
    reconcile: {
      removeApproval: (id) => reconciled.push({ op: "removeApproval", id }),
      upsertUserQuestion: (value) =>
        reconciled.push({ op: "upsertUserQuestion", id: value.id }),
      upsertPlanReview: (value) =>
        reconciled.push({ op: "upsertPlanReview", id: value.id }),
      upsertConversation: (value) =>
        reconciled.push({ op: "upsertConversation", id: value.id }),
      upsertAgent: (value) =>
        reconciled.push({ op: "upsertAgent", id: value.id }),
    },
    notify: {
      success: (title) => notifications.push({ kind: "success", title }),
      message: (title) => notifications.push({ kind: "message", title }),
      error: (title) => notifications.push({ kind: "error", title }),
    },
    openConversation: async (conversationId) => {
      calls.push(`openConversation:${conversationId}`);
    },
  };
  return {
    actions: createInteractionActions(deps),
    calls,
    notifications,
    reconciled,
  };
}

describe("result-driven interaction actions", () => {
  it("keeps the approval and rethrows when the request fails", async () => {
    const { actions, reconciled, notifications } = fixture({
      requests: {
        denyApproval: async () => {
          throw new Error("offline");
        },
      },
    });
    await assert.rejects(actions.denyApproval("approval_1"), /offline/);
    assert.deepEqual(reconciled, []);
    assert.deepEqual(notifications, [
      { kind: "error", title: "Could not deny approval" },
    ]);
  });

  it("keeps the plan review available for retry on rejection failure", async () => {
    const { actions, reconciled, notifications } = fixture({
      requests: {
        rejectPlanReview: async () => {
          throw new Error("server unavailable");
        },
      },
    });
    await assert.rejects(
      actions.rejectPendingPlanReview("review_1"),
      /server unavailable/,
    );
    assert.deepEqual(reconciled, []);
    assert.deepEqual(notifications, [
      { kind: "error", title: "Could not reject plan" },
    ]);
  });

  it("answers a question with one request and result reconciliation", async () => {
    const { actions, calls, reconciled, notifications } = fixture({});
    await actions.answerUserQuestionById("question_1", "  yes  ");
    assert.deepEqual(calls, ["answerUserQuestion"]);
    assert.deepEqual(reconciled, [
      { op: "upsertUserQuestion", id: "question_1" },
    ]);
    assert.deepEqual(notifications, [{ kind: "success", title: "Reply sent" }]);
  });
});
