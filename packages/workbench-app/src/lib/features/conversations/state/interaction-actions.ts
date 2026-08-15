import type {
  AgentRecord,
  ConversationRecord,
  PlanReviewResolveOptions,
  ToolCallRecord,
  ToolInteractionResolution,
} from "$lib/api";

export interface InteractionRequests {
  resolve(
    interactionId: string,
    resolution: ToolInteractionResolution,
  ): Promise<{
    toolCall: ToolCallRecord;
    effect?: {
      kind: "new_conversation";
      conversation: ConversationRecord;
      agent: AgentRecord;
    };
  }>;
}
export interface InteractionReconcilers {
  upsertToolCall(toolCall: ToolCallRecord): void;
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
  grantApproval(id: string): Promise<void>;
  denyApproval(id: string): Promise<void>;
  acceptPendingPlanReview(
    id: string,
    options?: PlanReviewResolveOptions,
  ): Promise<void>;
  acceptPendingPlanReviewInNewChat(
    id: string,
    options?: PlanReviewResolveOptions,
  ): Promise<void>;
  rejectPendingPlanReview(id: string): Promise<void>;
  requestPendingPlanChanges(id: string, feedback: string): Promise<void>;
  discardPendingPlanReview(id: string): Promise<void>;
  answerUserQuestionById(id: string, answer: string): Promise<void>;
  dismissUserQuestionById(id: string): Promise<void>;
}

export function createInteractionActions(
  deps: InteractionActionDeps,
): InteractionActions {
  async function resolve(
    id: string,
    resolution: ToolInteractionResolution,
    failureTitle: string,
  ) {
    try {
      const result = await deps.requests.resolve(id, resolution);
      deps.reconcile.upsertToolCall(result.toolCall);
      return result;
    } catch (caught) {
      deps.notify.error(failureTitle, {
        description: caught instanceof Error ? caught.message : String(caught),
      });
      throw caught;
    }
  }
  return {
    async grantApproval(id) {
      await resolve(
        id,
        { kind: "approval", action: "allow" },
        "Could not grant approval",
      );
      deps.notify.success("Approval granted");
    },
    async denyApproval(id) {
      await resolve(
        id,
        { kind: "approval", action: "deny", note: "Denied from UI." },
        "Could not deny approval",
      );
      deps.notify.message("Approval denied");
    },
    async acceptPendingPlanReview(id, options = {}) {
      await resolve(
        id,
        { kind: "plan_review", action: "accept", ...options },
        "Could not accept plan",
      );
      deps.notify.success("Plan accepted");
    },
    async acceptPendingPlanReviewInNewChat(id, options = {}) {
      const result = await resolve(
        id,
        { kind: "plan_review", action: "accept_in_new_chat", ...options },
        "Could not accept plan in new chat",
      );
      if (result.effect?.kind === "new_conversation") {
        deps.reconcile.upsertConversation(result.effect.conversation);
        deps.reconcile.upsertAgent(result.effect.agent);
        await deps.openConversation(result.effect.conversation.id);
      }
      deps.notify.success("Plan accepted in new chat");
    },
    async rejectPendingPlanReview(id) {
      await resolve(
        id,
        {
          kind: "plan_review",
          action: "reject",
          feedback: "Rejected from UI.",
        },
        "Could not reject plan",
      );
      deps.notify.message("Plan rejected");
    },
    async requestPendingPlanChanges(id, feedback) {
      await resolve(
        id,
        { kind: "plan_review", action: "request_changes", feedback },
        "Could not request plan changes",
      );
      deps.notify.message("Change request sent");
    },
    async discardPendingPlanReview(id) {
      await resolve(
        id,
        {
          kind: "plan_review",
          action: "discard",
          feedback: "Discarded from UI.",
        },
        "Could not discard plan",
      );
      deps.notify.message("Plan discarded");
    },
    async answerUserQuestionById(id, answer) {
      const trimmed = answer.trim();
      if (!trimmed) return;
      await resolve(
        id,
        { kind: "user_input", action: "answer", answer: trimmed },
        "Could not send reply",
      );
      deps.notify.success("Reply sent");
    },
    async dismissUserQuestionById(id) {
      await resolve(
        id,
        { kind: "user_input", action: "dismiss", reason: "Dismissed from UI." },
        "Could not dismiss question",
      );
      deps.notify.message("Question dismissed");
    },
  };
}
