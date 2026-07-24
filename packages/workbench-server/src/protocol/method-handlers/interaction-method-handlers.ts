import type { ModelSelection, ThinkingLevel } from "@nervekit/contracts";
import { planReviewPreview } from "../../domains/plans/plan-service.js";
import { toToolCallTranscriptRecord } from "../../domains/tools/tool-call-transcript-preview.js";
import { defineWorkbenchMethodHandlers } from "../method-handler-registry.js";

export const interactionMethodHandlers = defineWorkbenchMethodHandlers({
  "tool.list": (state) => ({ tools: state.registry.tools.listTools() }),
  "toolCall.list": (state, params) => {
    let toolCalls = state.registry.tools.listToolCalls();
    if (params?.status) {
      toolCalls = toolCalls.filter(
        (toolCall) => toolCall.status === params.status,
      );
    }
    if (params?.limit !== undefined)
      toolCalls = toolCalls.slice(0, params.limit);
    return { toolCalls: toolCalls.map(toToolCallTranscriptRecord) };
  },
  "toolCall.get": (state, params) => ({
    toolCall: state.registry.tools.getToolCall(params.toolCallId),
  }),
  "approval.list": (state, params) => ({
    approvals: state.registry.tools.listApprovals(params?.status),
  }),
  "approval.grant": async (state, params) => ({
    toolCall: await state.registry.grantApproval(
      params.approvalId,
      params.note,
    ),
  }),
  "approval.deny": async (state, params) => ({
    toolCall: await state.registry.denyApproval(params.approvalId, params.note),
  }),
  "userQuestion.list": (state, params) => ({
    questions: state.registry.listUserQuestions(params?.status),
  }),
  "userQuestion.answer": async (state, params) => ({
    question: await state.registry.answerUserQuestion(
      params.questionId,
      params.answer,
    ),
  }),
  "userQuestion.dismiss": async (state, params) => ({
    question: await state.registry.dismissUserQuestion(
      params.questionId,
      params.reason,
    ),
  }),
  "planReview.list": (state, params) => ({
    planReviews: state.registry
      .listPlanReviews(params?.status)
      .map(planReviewPreview),
  }),
  "planReview.accept": async (state, params) => {
    const planReview = await state.registry.acceptPlanReview(
      params.reviewId,
      params.feedback,
      implementation(params),
    );
    return { planReview: planReviewPreview(planReview) };
  },
  "planReview.acceptInNewChat": async (state, params) => {
    const result = await state.registry.acceptPlanReviewInNewChat(
      params.reviewId,
      params.feedback,
      implementation(params),
    );
    return { ...result, planReview: planReviewPreview(result.planReview) };
  },
  "planReview.requestChanges": async (state, params) => {
    const planReview = await state.registry.requestPlanChanges(
      params.reviewId,
      params.feedback,
    );
    return { planReview: planReviewPreview(planReview) };
  },
  "planReview.reject": async (state, params) => {
    const planReview = await state.registry.rejectPlanReview(
      params.reviewId,
      params.feedback,
    );
    return { planReview: planReviewPreview(planReview) };
  },
  "planReview.discard": async (state, params) => {
    const planReview = await state.registry.discardPlanReview(
      params.reviewId,
      params.feedback,
    );
    return { planReview: planReviewPreview(planReview) };
  },
});

function implementation(request: {
  implementationModel?: ModelSelection;
  implementationThinkingLevel?: ThinkingLevel;
}) {
  return {
    implementationModel: request.implementationModel,
    implementationThinkingLevel: request.implementationThinkingLevel,
  };
}
