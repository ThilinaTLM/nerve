import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationRenderState } from "@nervekit/shared-ui/state";
import {
  pendingPlanReviewRecord,
  pendingUserQuestionRecord,
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
    assert.equal(
      pendingPlanReviewRecord(detail, richState)?.toolCallId,
      "tool_normalized",
    );
    detail.waitsById.plan_review_1.status = "submitted";
    assert.equal(pendingPlanReviewRecord(detail, richState), undefined);
  });

  it("removes the ask-user prompt after submission", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.waitsById.ask_1 = {
      waitId: "ask_1",
      kind: "input",
      status: "waiting",
      toolCallId: "ask_1",
      question: { text: "Proceed?" },
      createdAt: ts,
    };
    assert.equal(pendingUserQuestionRecord(detail)?.question, "Proceed?");
    detail.waitsById.ask_1.status = "submitted";
    assert.equal(pendingUserQuestionRecord(detail), undefined);
  });
});
