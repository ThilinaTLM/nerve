import { notify } from "$lib/notifications/notify.svelte";
import {
  acceptPlanReview,
  answerUserQuestion,
  apiPost,
  discardPlanReview,
  dismissUserQuestion as dismissUserQuestionRequest,
  getPendingApprovals,
  getPendingPlanReviews,
  getPendingUserQuestions,
  rejectPlanReview,
  requestPlanChanges,
} from "../../api";
import { selection } from "../../state/app-state.svelte";
import { workbenchState } from "../workbench/state.svelte";
import { loadWorkspaceState } from "../workspace.svelte";
import { refreshConversationView } from "./selection";

export async function grantApproval(approvalId: string) {
  await apiPost(`/api/approvals/${approvalId}/grant`, {});
  workbenchState.approvals = await getPendingApprovals();
  notify.success("Approval granted");
}

export async function denyApproval(approvalId: string) {
  await apiPost(`/api/approvals/${approvalId}/deny`, {
    note: "Denied from UI.",
  });
  workbenchState.approvals = await getPendingApprovals();
  notify.message("Approval denied");
}

export async function acceptPendingPlanReview(reviewId: string) {
  await acceptPlanReview(reviewId);
  workbenchState.planReviews = await getPendingPlanReviews();
  await loadWorkspaceState();
  if (selection.conversationId)
    await refreshConversationView(selection.conversationId);
  notify.success("Plan accepted");
}

export async function rejectPendingPlanReview(reviewId: string) {
  await rejectPlanReview(reviewId, "Rejected from UI.");
  workbenchState.planReviews = await getPendingPlanReviews();
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
  workbenchState.planReviews = await getPendingPlanReviews();
  notify.message("Change request sent");
}

export async function discardPendingPlanReview(reviewId: string) {
  await discardPlanReview(reviewId, "Discarded from UI.");
  workbenchState.planReviews = await getPendingPlanReviews();
  notify.message("Plan discarded");
}

export async function answerUserQuestionById(
  questionId: string,
  answer: string,
) {
  const trimmed = answer.trim();
  if (!trimmed) return;
  await answerUserQuestion(questionId, trimmed);
  workbenchState.userQuestions = await getPendingUserQuestions();
  notify.success("Reply sent");
}

export async function dismissUserQuestionById(questionId: string) {
  await dismissUserQuestionRequest(questionId, "Dismissed from UI.");
  workbenchState.userQuestions = await getPendingUserQuestions();
  notify.message("Question dismissed");
}
