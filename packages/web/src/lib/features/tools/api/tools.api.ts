import type {
  AgentRecord,
  ApprovalRecord,
  ConversationRecord,
  ModelSelection,
  PlanReviewRecord,
  ToolCallRecord,
  ToolCallTranscriptRecord,
  UserQuestionRecord,
} from "@nervekit/shared";
import { apiGet, apiPathSegment, apiPost } from "../../../core/api/client";

export type ApprovalWithToolCall = ApprovalRecord & {
  toolCall?: ToolCallTranscriptRecord;
};

export type PlanReviewResolveOptions = {
  feedback?: string;
  implementationModel?: ModelSelection;
  implementationThinkingLevel?: AgentRecord["thinkingLevel"];
};

export async function getToolCalls(): Promise<ToolCallTranscriptRecord[]> {
  return (
    await apiGet<{ toolCalls: ToolCallTranscriptRecord[] }>("/api/tool-calls")
  ).toolCalls;
}

export async function getToolCall(toolCallId: string): Promise<ToolCallRecord> {
  return (
    await apiGet<{ toolCall: ToolCallRecord }>(
      `/api/tool-calls/${apiPathSegment(toolCallId)}`,
    )
  ).toolCall;
}

export async function getPendingApprovals(): Promise<ApprovalWithToolCall[]> {
  const [{ approvals }, { toolCalls }] = await Promise.all([
    apiGet<{ approvals: ApprovalRecord[] }>("/api/approvals?status=pending"),
    apiGet<{ toolCalls: ToolCallTranscriptRecord[] }>(
      "/api/tool-calls?status=pending_approval&limit=200",
    ),
  ]);
  const byId = new Map(toolCalls.map((toolCall) => [toolCall.id, toolCall]));
  return approvals.map((approval) => ({
    ...approval,
    toolCall: byId.get(approval.toolCallId),
  }));
}

export async function getPendingUserQuestions(): Promise<UserQuestionRecord[]> {
  return (
    await apiGet<{ questions: UserQuestionRecord[] }>(
      "/api/user-questions?status=pending",
    )
  ).questions;
}

export async function getPendingPlanReviews(): Promise<PlanReviewRecord[]> {
  return (
    await apiGet<{ planReviews: PlanReviewRecord[] }>(
      "/api/plan-reviews?status=pending",
    )
  ).planReviews;
}

export async function acceptPlanReview(
  reviewId: string,
  options: PlanReviewResolveOptions = {},
): Promise<PlanReviewRecord> {
  return (
    await apiPost<{ planReview: PlanReviewRecord }>(
      `/api/plan-reviews/${apiPathSegment(reviewId)}/accept`,
      options,
    )
  ).planReview;
}

export async function acceptPlanReviewInNewChat(
  reviewId: string,
  options: PlanReviewResolveOptions = {},
): Promise<{
  planReview: PlanReviewRecord;
  conversation: ConversationRecord;
  agent: AgentRecord;
}> {
  return apiPost(
    `/api/plan-reviews/${apiPathSegment(reviewId)}/accept-in-new-chat`,
    options,
  );
}

export async function rejectPlanReview(
  reviewId: string,
  feedback?: string,
): Promise<PlanReviewRecord> {
  return (
    await apiPost<{ planReview: PlanReviewRecord }>(
      `/api/plan-reviews/${apiPathSegment(reviewId)}/reject`,
      { feedback },
    )
  ).planReview;
}

export async function requestPlanChanges(
  reviewId: string,
  feedback?: string,
): Promise<PlanReviewRecord> {
  return (
    await apiPost<{ planReview: PlanReviewRecord }>(
      `/api/plan-reviews/${apiPathSegment(reviewId)}/request-changes`,
      { feedback },
    )
  ).planReview;
}

export async function discardPlanReview(
  reviewId: string,
  feedback?: string,
): Promise<PlanReviewRecord> {
  return (
    await apiPost<{ planReview: PlanReviewRecord }>(
      `/api/plan-reviews/${apiPathSegment(reviewId)}/discard`,
      { feedback },
    )
  ).planReview;
}

export async function answerUserQuestion(
  questionId: string,
  answer: string,
): Promise<UserQuestionRecord> {
  return (
    await apiPost<{ question: UserQuestionRecord }>(
      `/api/user-questions/${apiPathSegment(questionId)}/answer`,
      { answer },
    )
  ).question;
}

export async function dismissUserQuestion(
  questionId: string,
  reason?: string,
): Promise<UserQuestionRecord> {
  return (
    await apiPost<{ question: UserQuestionRecord }>(
      `/api/user-questions/${apiPathSegment(questionId)}/dismiss`,
      { reason },
    )
  ).question;
}
