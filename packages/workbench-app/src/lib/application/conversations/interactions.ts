import {
  resolveToolInteraction,
  type PlanReviewResolveOptions,
} from "$lib/features/tools/api/tools.api";
import { notify } from "$lib/application/notifications/notify.svelte";
import {
  upsertAgentRecordFresh,
  upsertConversationRecord,
  upsertPendingToolCall,
} from "$lib/application/workspace/entity-reducers";
import { createInteractionActions } from "$lib/features/conversations/state/interaction-actions";
import { openConversation } from "$lib/features/conversations/state/tabs";

const actions = createInteractionActions({
  requests: { resolve: resolveToolInteraction },
  reconcile: {
    upsertToolCall: upsertPendingToolCall,
    upsertConversation: upsertConversationRecord,
    upsertAgent: upsertAgentRecordFresh,
  },
  notify,
  openConversation,
});

export const grantApproval = (
  id: string,
  scope?:
    | "single_call"
    | "always_conversation"
    | "always_project"
    | "always_user",
) => actions.grantApproval(id, scope);
export const denyApproval = (id: string) => actions.denyApproval(id);
export const acceptPendingPlanReview = (
  id: string,
  options: PlanReviewResolveOptions = {},
) => actions.acceptPendingPlanReview(id, options);
export const acceptPendingPlanReviewInNewChat = (
  id: string,
  options: PlanReviewResolveOptions = {},
) => actions.acceptPendingPlanReviewInNewChat(id, options);
export const rejectPendingPlanReview = (id: string) =>
  actions.rejectPendingPlanReview(id);
export const requestPendingPlanChanges = (id: string, feedback: string) =>
  actions.requestPendingPlanChanges(id, feedback);
export const discardPendingPlanReview = (id: string) =>
  actions.discardPendingPlanReview(id);
export const answerUserQuestionById = (id: string, answer: string) =>
  actions.answerUserQuestionById(id, answer);
export const dismissUserQuestionById = (id: string) =>
  actions.dismissUserQuestionById(id);
