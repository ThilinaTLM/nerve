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
import { protocolRequest } from "../../../core/protocol/http-client";

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
    await protocolRequest<{ toolCalls: ToolCallTranscriptRecord[] }>(
      "toolCall.list",
      {},
    )
  ).result.toolCalls;
}

export async function getToolCall(toolCallId: string): Promise<ToolCallRecord> {
  return (
    await protocolRequest<{ toolCall: ToolCallRecord }>("toolCall.get", {
      toolCallId,
    })
  ).result.toolCall;
}

export async function getPendingApprovals(): Promise<ApprovalWithToolCall[]> {
  const [{ approvals }, { toolCalls }] = await Promise.all([
    protocolRequest<{ approvals: ApprovalRecord[] }>("approval.list", {
      status: "pending",
    }).then((response) => response.result),
    protocolRequest<{ toolCalls: ToolCallTranscriptRecord[] }>(
      "toolCall.list",
      { status: "pending_approval", limit: 200 },
    ).then((response) => response.result),
  ]);
  const byId = new Map(toolCalls.map((toolCall) => [toolCall.id, toolCall]));
  return approvals.map((approval) => ({
    ...approval,
    toolCall: byId.get(approval.toolCallId),
  }));
}

export async function getPendingUserQuestions(): Promise<UserQuestionRecord[]> {
  return (
    await protocolRequest<{ questions: UserQuestionRecord[] }>(
      "userQuestion.list",
      { status: "pending" },
    )
  ).result.questions;
}

export async function getPendingPlanReviews(): Promise<PlanReviewRecord[]> {
  return (
    await protocolRequest<{ planReviews: PlanReviewRecord[] }>(
      "planReview.list",
      { status: "pending" },
    )
  ).result.planReviews;
}

export async function grantApprovalRequest(
  approvalId: string,
  note?: string,
): Promise<ToolCallRecord> {
  return (
    await protocolRequest<{ toolCall: ToolCallRecord }>("approval.grant", {
      approvalId,
      note,
    })
  ).result.toolCall;
}

export async function denyApprovalRequest(
  approvalId: string,
  note?: string,
): Promise<ToolCallRecord> {
  return (
    await protocolRequest<{ toolCall: ToolCallRecord }>("approval.deny", {
      approvalId,
      note,
    })
  ).result.toolCall;
}

export async function acceptPlanReview(
  reviewId: string,
  options: PlanReviewResolveOptions = {},
): Promise<PlanReviewRecord> {
  return (
    await protocolRequest<{ planReview: PlanReviewRecord }>(
      "planReview.accept",
      { reviewId, ...options },
    )
  ).result.planReview;
}

export async function acceptPlanReviewInNewChat(
  reviewId: string,
  options: PlanReviewResolveOptions = {},
): Promise<{
  planReview: PlanReviewRecord;
  conversation: ConversationRecord;
  agent: AgentRecord;
}> {
  return (
    await protocolRequest<{
      planReview: PlanReviewRecord;
      conversation: ConversationRecord;
      agent: AgentRecord;
    }>("planReview.acceptInNewChat", { reviewId, ...options })
  ).result;
}

export async function rejectPlanReview(
  reviewId: string,
  feedback?: string,
): Promise<PlanReviewRecord> {
  return (
    await protocolRequest<{ planReview: PlanReviewRecord }>(
      "planReview.reject",
      { reviewId, feedback },
    )
  ).result.planReview;
}

export async function requestPlanChanges(
  reviewId: string,
  feedback?: string,
): Promise<PlanReviewRecord> {
  return (
    await protocolRequest<{ planReview: PlanReviewRecord }>(
      "planReview.requestChanges",
      { reviewId, feedback },
    )
  ).result.planReview;
}

export async function discardPlanReview(
  reviewId: string,
  feedback?: string,
): Promise<PlanReviewRecord> {
  return (
    await protocolRequest<{ planReview: PlanReviewRecord }>(
      "planReview.discard",
      { reviewId, feedback },
    )
  ).result.planReview;
}

export async function answerUserQuestion(
  questionId: string,
  answer: string,
): Promise<UserQuestionRecord> {
  return (
    await protocolRequest<{ question: UserQuestionRecord }>(
      "userQuestion.answer",
      { questionId, answer },
    )
  ).result.question;
}

export async function dismissUserQuestion(
  questionId: string,
  reason?: string,
): Promise<UserQuestionRecord> {
  return (
    await protocolRequest<{ question: UserQuestionRecord }>(
      "userQuestion.dismiss",
      { questionId, reason },
    )
  ).result.question;
}
