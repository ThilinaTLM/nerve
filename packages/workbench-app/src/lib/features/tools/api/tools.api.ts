import {
  planReviewRecordSchema,
  toolCallRecordSchema,
  userQuestionRecordSchema,
} from "@nervekit/contracts";
import type {
  AgentRecord,
  ConversationRecord,
  PlanReviewRecord,
  ToolCallRecord,
  UserQuestionRecord,
} from "@nervekit/contracts";
import { protocolRequest } from "@nervekit/protocol";
import type { PlanReviewResolveOptions } from "../../../presentation/state/tool-types.js";
export type {
  ApprovalWithToolCall,
  PlanReviewResolveOptions,
} from "../../../presentation/state/tool-types.js";

export async function getToolCall(toolCallId: string): Promise<ToolCallRecord> {
  const result = (
    await protocolRequest("toolCall.get", {
      toolCallId,
    })
  ).result;
  return toolCallRecordSchema.parse(result.toolCall);
}

export async function getPendingUserQuestions(): Promise<UserQuestionRecord[]> {
  return (await protocolRequest("userQuestion.list", { status: "pending" }))
    .result.questions;
}

export async function grantApprovalRequest(
  approvalId: string,
  note?: string,
): Promise<ToolCallRecord> {
  const result = (
    await protocolRequest("approval.grant", {
      approvalId,
      note,
    })
  ).result;
  if (!("toolCall" in result)) throw unexpectedAsyncResult("approval.grant");
  return toolCallRecordSchema.parse(result.toolCall);
}

export async function denyApprovalRequest(
  approvalId: string,
  note?: string,
): Promise<ToolCallRecord> {
  const result = (
    await protocolRequest("approval.deny", {
      approvalId,
      note,
    })
  ).result;
  if (!("toolCall" in result)) throw unexpectedAsyncResult("approval.deny");
  return toolCallRecordSchema.parse(result.toolCall);
}

export async function acceptPlanReview(
  reviewId: string,
  options: PlanReviewResolveOptions = {},
): Promise<PlanReviewRecord> {
  const result = (
    await protocolRequest("planReview.accept", { reviewId, ...options })
  ).result;
  if (!("planReview" in result))
    throw unexpectedAsyncResult("planReview.accept");
  return planReviewRecordSchema.parse(result.planReview);
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
    await protocolRequest("planReview.acceptInNewChat", {
      reviewId,
      ...options,
    })
  ).result;
}

export async function rejectPlanReview(
  reviewId: string,
  feedback?: string,
): Promise<PlanReviewRecord> {
  const result = (
    await protocolRequest("planReview.reject", { reviewId, feedback })
  ).result;
  if (!("planReview" in result))
    throw unexpectedAsyncResult("planReview.reject");
  return planReviewRecordSchema.parse(result.planReview);
}

export async function requestPlanChanges(
  reviewId: string,
  feedback?: string,
): Promise<PlanReviewRecord> {
  const result = (
    await protocolRequest("planReview.requestChanges", { reviewId, feedback })
  ).result;
  if (!("planReview" in result))
    throw unexpectedAsyncResult("planReview.requestChanges");
  return planReviewRecordSchema.parse(result.planReview);
}

export async function discardPlanReview(
  reviewId: string,
  feedback?: string,
): Promise<PlanReviewRecord> {
  const result = (
    await protocolRequest("planReview.discard", { reviewId, feedback })
  ).result;
  if (!("planReview" in result))
    throw unexpectedAsyncResult("planReview.discard");
  return planReviewRecordSchema.parse(result.planReview);
}

export async function answerUserQuestion(
  questionId: string,
  answer: string,
): Promise<UserQuestionRecord> {
  const result = (
    await protocolRequest("userQuestion.answer", { questionId, answer })
  ).result;
  if (!("question" in result))
    throw unexpectedAsyncResult("userQuestion.answer");
  return userQuestionRecordSchema.parse(result.question);
}

export async function dismissUserQuestion(
  questionId: string,
  reason?: string,
): Promise<UserQuestionRecord> {
  const result = (
    await protocolRequest("userQuestion.dismiss", { questionId, reason })
  ).result;
  if (!("question" in result))
    throw unexpectedAsyncResult("userQuestion.dismiss");
  return userQuestionRecordSchema.parse(result.question);
}

function unexpectedAsyncResult(method: string): Error {
  return new Error(`Workbench operation ${method} returned an async result`);
}
