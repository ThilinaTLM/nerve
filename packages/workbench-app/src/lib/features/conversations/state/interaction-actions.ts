import type {
  AgentRecord,
  ConversationRecord,
  PlanReviewRecord,
  PlanReviewResolveOptions,
  ToolCallRecord,
  UserQuestionRecord,
} from "$lib/api";

/**
 * Framework-neutral human-interaction actions. Each action performs exactly
 * one RPC, reconciles local state from the returned record (result-driven,
 * not refetch-driven), and only then reports success. Failures keep the
 * pending entity available for retry, notify, and rethrow so callers can
 * clear their in-flight state and render an inline error.
 */
export interface InteractionRequests {
  grantApproval(approvalId: string, note?: string): Promise<ToolCallRecord>;
  denyApproval(approvalId: string, note?: string): Promise<ToolCallRecord>;
  acceptPlanReview(
    reviewId: string,
    options: PlanReviewResolveOptions,
  ): Promise<PlanReviewRecord>;
  acceptPlanReviewInNewChat(
    reviewId: string,
    options: PlanReviewResolveOptions,
  ): Promise<{
    planReview: PlanReviewRecord;
    conversation: ConversationRecord;
    agent: AgentRecord;
  }>;
  rejectPlanReview(
    reviewId: string,
    feedback?: string,
  ): Promise<PlanReviewRecord>;
  requestPlanChanges(
    reviewId: string,
    feedback?: string,
  ): Promise<PlanReviewRecord>;
  discardPlanReview(
    reviewId: string,
    feedback?: string,
  ): Promise<PlanReviewRecord>;
  answerUserQuestion(
    questionId: string,
    answer: string,
  ): Promise<UserQuestionRecord>;
  dismissUserQuestion(
    questionId: string,
    reason?: string,
  ): Promise<UserQuestionRecord>;
}

export interface InteractionReconcilers {
  removeApproval(approvalId: string): void;
  upsertUserQuestion(question: UserQuestionRecord): void;
  upsertPlanReview(review: PlanReviewRecord): void;
  upsertConversation(conversation: ConversationRecord): void;
  upsertAgent(agent: AgentRecord): void;
}

export interface InteractionNotifier {
  success(title: string, options?: { description?: string }): void;
  message(title: string, options?: { description?: string }): void;
  error(title: string, options?: { description?: string }): void;
}

export interface InteractionActionDeps {
  requests: InteractionRequests;
  reconcile: InteractionReconcilers;
  notify: InteractionNotifier;
  openConversation(conversationId: string): Promise<void>;
}

export interface InteractionActions {
  grantApproval(approvalId: string): Promise<void>;
  denyApproval(approvalId: string): Promise<void>;
  acceptPendingPlanReview(
    reviewId: string,
    options?: PlanReviewResolveOptions,
  ): Promise<void>;
  acceptPendingPlanReviewInNewChat(
    reviewId: string,
    options?: PlanReviewResolveOptions,
  ): Promise<void>;
  rejectPendingPlanReview(reviewId: string): Promise<void>;
  requestPendingPlanChanges(reviewId: string, feedback: string): Promise<void>;
  discardPendingPlanReview(reviewId: string): Promise<void>;
  answerUserQuestionById(questionId: string, answer: string): Promise<void>;
  dismissUserQuestionById(questionId: string): Promise<void>;
}

export function createInteractionActions(
  deps: InteractionActionDeps,
): InteractionActions {
  async function request<T>(
    failureTitle: string,
    action: () => Promise<T>,
  ): Promise<T> {
    try {
      return await action();
    } catch (caught) {
      const description =
        caught instanceof Error ? caught.message : String(caught);
      deps.notify.error(failureTitle, { description });
      throw caught;
    }
  }

  return {
    async grantApproval(approvalId) {
      await request("Could not grant approval", () =>
        deps.requests.grantApproval(approvalId),
      );
      deps.reconcile.removeApproval(approvalId);
      deps.notify.success("Approval granted");
    },

    async denyApproval(approvalId) {
      await request("Could not deny approval", () =>
        deps.requests.denyApproval(approvalId, "Denied from UI."),
      );
      deps.reconcile.removeApproval(approvalId);
      deps.notify.message("Approval denied");
    },

    async acceptPendingPlanReview(reviewId, options = {}) {
      const review = await request("Could not accept plan", () =>
        deps.requests.acceptPlanReview(reviewId, options),
      );
      deps.reconcile.upsertPlanReview(review);
      deps.notify.success("Plan accepted");
    },

    async acceptPendingPlanReviewInNewChat(reviewId, options = {}) {
      const result = await request("Could not accept plan in new chat", () =>
        deps.requests.acceptPlanReviewInNewChat(reviewId, options),
      );
      // Install the returned records directly instead of reloading the
      // workspace, then navigate. Durable events keep later state converged.
      deps.reconcile.upsertConversation(result.conversation);
      deps.reconcile.upsertAgent(result.agent);
      deps.reconcile.upsertPlanReview(result.planReview);
      await deps.openConversation(result.conversation.id);
      deps.notify.success("Plan accepted in new chat");
    },

    async rejectPendingPlanReview(reviewId) {
      const review = await request("Could not reject plan", () =>
        deps.requests.rejectPlanReview(reviewId, "Rejected from UI."),
      );
      deps.reconcile.upsertPlanReview(review);
      deps.notify.message("Plan rejected");
    },

    async requestPendingPlanChanges(reviewId, feedback) {
      const review = await request("Could not request plan changes", () =>
        deps.requests.requestPlanChanges(reviewId, feedback),
      );
      deps.reconcile.upsertPlanReview(review);
      deps.notify.message("Change request sent");
    },

    async discardPendingPlanReview(reviewId) {
      const review = await request("Could not discard plan", () =>
        deps.requests.discardPlanReview(reviewId, "Discarded from UI."),
      );
      deps.reconcile.upsertPlanReview(review);
      deps.notify.message("Plan discarded");
    },

    async answerUserQuestionById(questionId, answer) {
      const trimmed = answer.trim();
      if (!trimmed) return;
      const question = await request("Could not send reply", () =>
        deps.requests.answerUserQuestion(questionId, trimmed),
      );
      deps.reconcile.upsertUserQuestion(question);
      deps.notify.success("Reply sent");
    },

    async dismissUserQuestionById(questionId) {
      const question = await request("Could not dismiss question", () =>
        deps.requests.dismissUserQuestion(questionId, "Dismissed from UI."),
      );
      deps.reconcile.upsertUserQuestion(question);
      deps.notify.message("Question dismissed");
    },
  };
}
