import type {
  ModelSelection,
  ProtocolMethodName,
  ThinkingLevel,
} from "@nervekit/shared";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import { planReviewPreview } from "../domains/plans/plan-service.js";
import {
  getConversationSnapshotResponse,
  getWorkspaceSnapshotResponse,
} from "./snapshots.js";

export async function handleProtocolMethod(
  state: OrchestratorState,
  method: ProtocolMethodName,
  params: unknown,
): Promise<unknown> {
  switch (method) {
    case "snapshot.workspace.get":
      return getWorkspaceSnapshotResponse(state);
    case "snapshot.conversation.get":
      return getConversationSnapshotResponse(
        state,
        (params as { conversationId: string }).conversationId,
      );
    case "approval.grant":
      return {
        toolCall: await state.registry.grantApproval(
          (params as { approvalId: string; note?: string }).approvalId,
          (params as { note?: string }).note,
        ),
      };
    case "approval.deny":
      return {
        toolCall: await state.registry.denyApproval(
          (params as { approvalId: string; note?: string }).approvalId,
          (params as { note?: string }).note,
        ),
      };
    case "userQuestion.answer":
      return {
        question: await state.registry.answerUserQuestion(
          (params as { questionId: string; answer: string }).questionId,
          (params as { answer: string }).answer,
        ),
      };
    case "userQuestion.dismiss":
      return {
        question: await state.registry.dismissUserQuestion(
          (params as { questionId: string; reason?: string }).questionId,
          (params as { reason?: string }).reason,
        ),
      };
    case "planReview.accept": {
      const request = params as PlanReviewParams;
      const planReview = await state.registry.acceptPlanReview(
        request.reviewId,
        request.feedback,
        implementation(request),
      );
      return { planReview: planReviewPreview(planReview) };
    }
    case "planReview.acceptInNewChat": {
      const request = params as PlanReviewParams;
      const result = await state.registry.acceptPlanReviewInNewChat(
        request.reviewId,
        request.feedback,
        implementation(request),
      );
      return { ...result, planReview: planReviewPreview(result.planReview) };
    }
    case "planReview.requestChanges": {
      const request = params as PlanReviewParams;
      const planReview = await state.registry.requestPlanChanges(
        request.reviewId,
        request.feedback,
      );
      return { planReview: planReviewPreview(planReview) };
    }
    case "planReview.reject": {
      const request = params as PlanReviewParams;
      const planReview = await state.registry.rejectPlanReview(
        request.reviewId,
        request.feedback,
      );
      return { planReview: planReviewPreview(planReview) };
    }
    case "planReview.discard": {
      const request = params as PlanReviewParams;
      const planReview = await state.registry.discardPlanReview(
        request.reviewId,
        request.feedback,
      );
      return { planReview: planReviewPreview(planReview) };
    }
  }
}

interface PlanReviewParams {
  reviewId: string;
  feedback?: string;
  implementationModel?: ModelSelection;
  implementationThinkingLevel?: ThinkingLevel;
}

function implementation(request: PlanReviewParams) {
  return {
    implementationModel: request.implementationModel,
    implementationThinkingLevel: request.implementationThinkingLevel,
  };
}
