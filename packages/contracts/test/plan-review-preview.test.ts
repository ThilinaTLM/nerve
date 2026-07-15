import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PLAN_REVIEW_FEEDBACK_PREVIEW_CHARACTERS,
  PLAN_REVIEW_PATH_PREVIEW_CHARACTERS,
  PLAN_REVIEW_PREVIEW_CHARACTERS,
  PLAN_REVIEW_PREVIEW_LINES,
  PLAN_REVIEW_SUMMARY_PREVIEW_CHARACTERS,
  PLAN_REVIEW_TITLE_PREVIEW_CHARACTERS,
  type PlanReviewRecord,
  toPlanReviewPreview,
  validatePublicEvent,
} from "../src/index.js";

const baseReview: PlanReviewRecord = {
  id: "plan_review_preview",
  toolCallId: "tool_preview",
  agentId: "agent_preview",
  conversationId: "conv_preview",
  projectId: "proj_preview",
  slug: "preview",
  planPath: "/tmp/preview.md",
  status: "pending",
  requestedAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
};

describe("toPlanReviewPreview", () => {
  it("bounds public content by lines without mutating stored content", () => {
    const content = Array.from(
      { length: PLAN_REVIEW_PREVIEW_LINES + 4 },
      (_, index) => `line ${index}`,
    ).join("\n");
    const review = { ...baseReview, content };

    const preview = toPlanReviewPreview(review);

    assert.equal(review.content, content);
    assert.equal(
      preview.content,
      content.split("\n").slice(0, PLAN_REVIEW_PREVIEW_LINES).join("\n"),
    );
  });

  it("bounds all public text and validates within the event budget", () => {
    const oversized = "界".repeat(25_000);
    const review = {
      ...baseReview,
      title: oversized,
      summary: oversized,
      planPath: `/${oversized}`,
      content: oversized,
      feedback: oversized,
    };

    const preview = toPlanReviewPreview(review);

    assert.equal(preview.content?.length, PLAN_REVIEW_PREVIEW_CHARACTERS);
    assert.equal(preview.title?.length, PLAN_REVIEW_TITLE_PREVIEW_CHARACTERS);
    assert.equal(
      preview.summary?.length,
      PLAN_REVIEW_SUMMARY_PREVIEW_CHARACTERS,
    );
    assert.equal(preview.planPath.length, PLAN_REVIEW_PATH_PREVIEW_CHARACTERS);
    assert.equal(
      preview.feedback?.length,
      PLAN_REVIEW_FEEDBACK_PREVIEW_CHARACTERS,
    );
    assert.doesNotThrow(() =>
      validatePublicEvent(
        "planReview.updated",
        { planReview: preview },
        "workbench_server",
      ),
    );
  });
});
