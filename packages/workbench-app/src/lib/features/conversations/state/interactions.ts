import {
  acceptPlanReview,
  acceptPlanReviewInNewChat,
  answerUserQuestion,
  denyApprovalRequest,
  discardPlanReview,
  dismissUserQuestion as dismissUserQuestionRequest,
  grantApprovalRequest,
  type PlanReviewResolveOptions,
  rejectPlanReview,
  requestPlanChanges,
} from "$lib/api";
import { notify } from "$lib/features/notifications/notify.svelte";
import {
  removeApproval,
  upsertAgentRecordFresh,
  upsertConversationRecord,
  upsertPlanReview,
  upsertUserQuestion,
} from "$lib/features/workspace/state/entity-reducers";
import { createInteractionActions } from "./interaction-actions";
import { openConversation } from "./tabs";

/**
 * Result-driven interaction handlers: each RPC's returned record reconciles
 * local state immediately via the shared entity reducers, while conversation
 * and run durable events remain responsible for transcript progression.
 */
const actions = createInteractionActions({
  requests: {
    grantApproval: grantApprovalRequest,
    denyApproval: denyApprovalRequest,
    acceptPlanReview,
    acceptPlanReviewInNewChat,
    rejectPlanReview,
    requestPlanChanges,
    discardPlanReview,
    answerUserQuestion,
    dismissUserQuestion: dismissUserQuestionRequest,
  },
  reconcile: {
    removeApproval,
    upsertUserQuestion,
    upsertPlanReview,
    upsertConversation: upsertConversationRecord,
    upsertAgent: upsertAgentRecordFresh,
  },
  notify,
  openConversation,
});

export async function grantApproval(approvalId: string) {
  await actions.grantApproval(approvalId);
}

export async function denyApproval(approvalId: string) {
  await actions.denyApproval(approvalId);
}

export async function acceptPendingPlanReview(
  reviewId: string,
  options: PlanReviewResolveOptions = {},
) {
  await actions.acceptPendingPlanReview(reviewId, options);
}

export async function acceptPendingPlanReviewInNewChat(
  reviewId: string,
  options: PlanReviewResolveOptions = {},
) {
  await actions.acceptPendingPlanReviewInNewChat(reviewId, options);
}

export async function rejectPendingPlanReview(reviewId: string) {
  await actions.rejectPendingPlanReview(reviewId);
}

export async function requestPendingPlanChanges(
  reviewId: string,
  feedback: string,
) {
  await actions.requestPendingPlanChanges(reviewId, feedback);
}

export async function discardPendingPlanReview(reviewId: string) {
  await actions.discardPendingPlanReview(reviewId);
}

export async function answerUserQuestionById(
  questionId: string,
  answer: string,
) {
  await actions.answerUserQuestionById(questionId, answer);
}

export async function dismissUserQuestionById(questionId: string) {
  await actions.dismissUserQuestionById(questionId);
}
