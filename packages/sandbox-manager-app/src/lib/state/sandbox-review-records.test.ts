import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationRenderState } from "@nervekit/workbench-ui/state";
import {
  pendingPlanReviewRecords,
  pendingUserQuestionRecords,
} from "./sandbox-review-records";
import { createSandboxDetailState } from "./sandbox-ui-types";

const ts = "2026-07-10T00:00:00.000Z";

const richState: ConversationRenderState = {
  conversationId: "conv_1",
  entries: [],
  activeEntryIds: [],
  toolCalls: [
    {
      id: "tool_normalized",
      sourceToolCallId: "provider_plan_1",
      providerToolCallId: "provider_plan_1",
      conversationId: "conv_1",
      agentId: "agent_1",
      projectId: "proj_1",
      runId: "run_1",
      toolName: "plan_mode_present",
      risk: "interaction",
      cwd: "/workspace",
      status: "waiting_for_user",
      createdAt: ts,
      updatedAt: ts,
    },
  ],
  cursorSeq: 0,
};

describe("sandbox review projections", () => {
  it("matches a raw plan tool id to the normalized transcript tool id", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.waitsById.plan_review_1 = {
      waitId: "plan_review_1",
      kind: "plan_review",
      status: "waiting",
      toolCallId: "provider_plan_1",
      planReview: {
        id: "plan_review_1",
        toolCallId: "tool_original",
        agentId: "agent_1",
        conversationId: "conv_1",
        projectId: "proj_1",
        slug: "feature",
        planPath: "/state/plans/feature.md",
        content: "# Feature",
        status: "pending",
        requestedAt: ts,
        updatedAt: ts,
      },
      createdAt: ts,
    };
    detail.waitsById.plan_review_2 = {
      waitId: "plan_review_2",
      kind: "plan_review",
      status: "waiting",
      toolCallId: "tool_plan_2",
      planReview: {
        id: "plan_review_2",
        toolCallId: "tool_plan_2",
        agentId: "agent_1",
        conversationId: "conv_1",
        projectId: "proj_1",
        slug: "feature-two",
        planPath: "/state/plans/feature-two.md",
        content: "# Feature two",
        status: "pending",
        requestedAt: ts,
        updatedAt: ts,
      },
      createdAt: ts,
    };
    detail.waitsById.plan_review_other = {
      ...detail.waitsById.plan_review_2,
      waitId: "plan_review_other",
      planReview: {
        ...detail.waitsById.plan_review_2.planReview!,
        id: "plan_review_other",
        conversationId: "conv_other",
      },
    };
    assert.equal(pendingPlanReviewRecords(detail, richState).length, 2);
    assert.equal(
      pendingPlanReviewRecords(detail, richState)[0]?.toolCallId,
      "tool_normalized",
    );
    detail.waitsById.plan_review_1.status = "submitted";
    assert.deepEqual(
      pendingPlanReviewRecords(detail, richState).map((review) => review.id),
      ["plan_review_2"],
    );
  });

  it("projects every ask-user prompt and removes only submitted prompts", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.waitsById.ask_1 = {
      waitId: "ask_1",
      kind: "input",
      status: "waiting",
      toolCallId: "ask_1",
      question: { text: "Proceed?" },
      createdAt: ts,
    };
    detail.waitsById.ask_2 = {
      waitId: "ask_2",
      kind: "input",
      status: "waiting",
      toolCallId: "ask_2",
      question: { text: "Which option?" },
      createdAt: ts,
    };
    assert.deepEqual(
      pendingUserQuestionRecords(detail).map((question) => question.question),
      ["Proceed?", "Which option?"],
    );
    detail.waitsById.ask_2.status = "submitted";
    assert.deepEqual(
      pendingUserQuestionRecords(detail).map((question) => question.question),
      ["Proceed?"],
    );
  });
});
