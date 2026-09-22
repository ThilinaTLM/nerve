import type { PlanReviewRecord } from "@nervekit/contracts/plans";
import type { ToolCallTranscriptRecord } from "@nervekit/contracts/tools";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePlanReview } from "./plan-review-state";

const requestedAt = "2026-09-22T16:35:37.000Z";
const updatedAt = "2026-09-22T16:35:38.000Z";

function planReviewToolCall(
  interaction: ToolCallTranscriptRecord["interactions"][number] = {
    kind: "plan_review",
    ordinal: 0,
    status: "pending",
    requestedAt,
    updatedAt,
    request: {
      planPath: "/tmp/plans/update-local-branch.md",
      slug: "update-local-branch",
      title: "Update local branch",
      summary: "Update the local branch after merging.",
      allowNewConversation: true,
    },
  },
): NonNullable<Parameters<typeof resolvePlanReview>[0]> {
  return {
    id: "tool_plan",
    agentId: "agent_main",
    conversationId: "conv_main",
    projectId: "proj_main",
    toolName: "plan_mode_present",
    status: "waiting",
    interactions: [interaction],
  };
}

describe("resolvePlanReview", () => {
  it("prefers a matching pending workspace projection", () => {
    const projected: PlanReviewRecord = {
      id: "plan_review_tool_plan_0",
      toolCallId: "tool_plan",
      agentId: "agent_main",
      conversationId: "conv_main",
      projectId: "proj_main",
      slug: "update-local-branch",
      planPath: "/tmp/plans/update-local-branch.md",
      content: "Full projected plan",
      status: "pending",
      requestedAt,
      updatedAt,
    };

    assert.equal(resolvePlanReview(planReviewToolCall(), projected), projected);
  });

  it("derives the pending review from the durable interaction during handoff", () => {
    assert.deepEqual(resolvePlanReview(planReviewToolCall(), undefined), {
      id: "plan_review_tool_plan_0",
      toolCallId: "tool_plan",
      agentId: "agent_main",
      conversationId: "conv_main",
      projectId: "proj_main",
      slug: "update-local-branch",
      title: "Update local branch",
      summary: "Update the local branch after merging.",
      planPath: "/tmp/plans/update-local-branch.md",
      status: "pending",
      requestedAt,
      updatedAt,
    });
  });

  it("does not expose controls for settled or non-plan interactions", () => {
    const resolved = planReviewToolCall({
      kind: "plan_review",
      ordinal: 0,
      status: "resolved",
      requestedAt,
      updatedAt,
      resolvedAt: updatedAt,
      request: {
        planPath: "/tmp/plans/update-local-branch.md",
        slug: "update-local-branch",
        allowNewConversation: true,
      },
      resolution: { action: "accept" },
    });
    const question = planReviewToolCall({
      kind: "user_input",
      ordinal: 0,
      status: "pending",
      requestedAt,
      updatedAt,
      request: {
        question: "Continue?",
        required: true,
      },
    });

    assert.equal(resolvePlanReview(resolved, undefined), undefined);
    assert.equal(resolvePlanReview(question, undefined), undefined);
    assert.equal(
      resolvePlanReview(
        { ...planReviewToolCall(), status: "completed" },
        undefined,
      ),
      undefined,
    );
  });
});
