import {
  acceptPlanReview,
  acceptPlanReviewInNewChat,
  answerUserQuestion,
  apiPathSegment,
  apiPost,
  discardPlanReview,
  dismissUserQuestion as dismissUserQuestionRequest,
  getPendingApprovals,
  getPendingPlanReviews,
  getPendingUserQuestions,
  type PlanReviewResolveOptions,
  rejectPlanReview,
  requestPlanChanges,
} from "$lib/api";
import { notify } from "$lib/features/notifications/notify.svelte";
import { selection } from "$lib/features/workspace/state/selection.svelte";
import { loadWorkspaceState } from "$lib/features/workspace/state/workspace-actions.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import { refreshConversationView } from "./selection";
import { openConversation } from "./tabs";

export async function grantApproval(approvalId: string) {
  await apiPost(`/api/approvals/${apiPathSegment(approvalId)}/grant`, {});
  workspaceState.approvals = await getPendingApprovals();
  notify.success("Approval granted");
}

export async function denyApproval(approvalId: string) {
  await apiPost(`/api/approvals/${apiPathSegment(approvalId)}/deny`, {
    note: "Denied from UI.",
  });
  workspaceState.approvals = await getPendingApprovals();
  notify.message("Approval denied");
}

export async function acceptPendingPlanReview(
  reviewId: string,
  options: PlanReviewResolveOptions = {},
) {
  await acceptPlanReview(reviewId, options);
  workspaceState.planReviews = await getPendingPlanReviews();
  await loadWorkspaceState();
  if (selection.conversationId)
    await refreshConversationView(selection.conversationId);
  notify.success("Plan accepted");
}

export async function acceptPendingPlanReviewInNewChat(
  reviewId: string,
  options: PlanReviewResolveOptions = {},
) {
  const { conversation } = await acceptPlanReviewInNewChat(reviewId, options);
  workspaceState.planReviews = await getPendingPlanReviews();
  await loadWorkspaceState();
  await openConversation(conversation.id);
  notify.success("Plan accepted in new chat");
}

export async function rejectPendingPlanReview(reviewId: string) {
  await rejectPlanReview(reviewId, "Rejected from UI.");
  workspaceState.planReviews = await getPendingPlanReviews();
  await loadWorkspaceState();
  if (selection.conversationId)
    await refreshConversationView(selection.conversationId);
  notify.message("Plan rejected");
}

export async function requestPendingPlanChanges(
  reviewId: string,
  feedback: string,
) {
  await requestPlanChanges(reviewId, feedback);
  workspaceState.planReviews = await getPendingPlanReviews();
  notify.message("Change request sent");
}

export async function discardPendingPlanReview(reviewId: string) {
  await discardPlanReview(reviewId, "Discarded from UI.");
  workspaceState.planReviews = await getPendingPlanReviews();
  notify.message("Plan discarded");
}

export async function answerUserQuestionById(
  questionId: string,
  answer: string,
) {
  const trimmed = answer.trim();
  if (!trimmed) return;
  await answerUserQuestion(questionId, trimmed);
  workspaceState.userQuestions = await getPendingUserQuestions();
  notify.success("Reply sent");
}

export async function dismissUserQuestionById(questionId: string) {
  await dismissUserQuestionRequest(questionId, "Dismissed from UI.");
  workspaceState.userQuestions = await getPendingUserQuestions();
  notify.message("Question dismissed");
}
