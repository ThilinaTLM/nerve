import type { PlanReviewRecord } from "./plan-review.schema.js";

export const PLAN_REVIEW_PREVIEW_LINES = 10;
export const PLAN_REVIEW_PREVIEW_CHARACTERS = 8_000;
export const PLAN_REVIEW_TITLE_PREVIEW_CHARACTERS = 1_000;
export const PLAN_REVIEW_SUMMARY_PREVIEW_CHARACTERS = 2_000;
export const PLAN_REVIEW_PATH_PREVIEW_CHARACTERS = 4_096;
export const PLAN_REVIEW_FEEDBACK_PREVIEW_CHARACTERS = 2_000;

/** Returns a bounded public projection while preserving the full stored review. */
export function toPlanReviewPreview(
  review: PlanReviewRecord,
): PlanReviewRecord {
  const content = review.content
    ?.split("\n")
    .slice(0, PLAN_REVIEW_PREVIEW_LINES)
    .join("\n")
    .slice(0, PLAN_REVIEW_PREVIEW_CHARACTERS);
  return {
    ...review,
    title: bounded(review.title, PLAN_REVIEW_TITLE_PREVIEW_CHARACTERS),
    summary: bounded(review.summary, PLAN_REVIEW_SUMMARY_PREVIEW_CHARACTERS),
    planPath: review.planPath.slice(0, PLAN_REVIEW_PATH_PREVIEW_CHARACTERS),
    content,
    feedback: bounded(review.feedback, PLAN_REVIEW_FEEDBACK_PREVIEW_CHARACTERS),
  };
}

function bounded(value: string | undefined, maximum: number) {
  return value?.slice(0, maximum);
}
