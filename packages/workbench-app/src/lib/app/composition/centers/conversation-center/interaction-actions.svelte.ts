import { createId } from "@nervekit/contracts";
import type {
  InteractionResolution,
  UserInputAnswer,
} from "@nervekit/contracts/core";
import { notify } from "$lib/application/notifications/notify.svelte";
import type { ConversationStore } from "$lib/features/conversations/state/core-conversation-store.svelte";
import type { PlanReviewResolveOptions } from "$lib/presentation/view-models/conversation";

type ApprovalScope =
  | "single_call"
  | "always_conversation"
  | "always_project"
  | "always_user";

/** Resolves pending approvals, questions and plan reviews on the viewed store. */
export function createInteractionActions(
  getStore: () => ConversationStore | undefined,
) {
  async function resolve(
    toolCallId: string,
    resolution: InteractionResolution,
  ) {
    const result = await getStore()?.resolve(toolCallId, resolution);
    if (result?.status === "refresh_required") {
      const message =
        result.reason === "requirement_conflict"
          ? "Profile requirements conflict with the chosen model or reasoning. The plan remains open; repair the conflict and confirm again. No implementation request was submitted."
          : "Profile or configuration changed, or a previous approval was interrupted. The plan remains open; review the current configuration and refreshed requirements, then confirm again. No implementation request was submitted.";
      notify.warning("Plan review needs new confirmation", {
        description: message,
        duration: 10000,
      });
      throw new Error(message);
    }
    if (result?.status === "unavailable")
      throw new Error(
        "Configuration unavailable; reload it before confirming again. The review remains open and no implementation request was submitted.",
      );
  }

  return {
    answerUserQuestion(
      toolCallId: string,
      answers: Record<string, UserInputAnswer>,
    ) {
      return resolve(toolCallId, { kind: "user_input", answers });
    },
    dismissUserQuestion(toolCallId: string) {
      return resolve(toolCallId, {
        kind: "user_input",
        answers: {},
        dismissed: true,
      });
    },
    grantApproval(toolCallId: string, scope?: ApprovalScope) {
      return resolve(toolCallId, {
        kind: "approval",
        decision: "approve",
        persistScope:
          scope === "always_conversation"
            ? "conversation"
            : scope === "always_project"
              ? "project"
              : scope === "always_user"
                ? "user"
                : undefined,
      });
    },
    denyApproval(toolCallId: string) {
      return resolve(toolCallId, { kind: "approval", decision: "deny" });
    },
    async acceptPendingPlanReview(
      toolCallId: string,
      options?: PlanReviewResolveOptions,
    ) {
      if (options?.compactBeforeImplementation)
        throw new Error(
          "Compacting a pending plan is not supported by the conversation core",
        );

      const interaction = getStore()?.snapshot?.toolCalls.find(
        (item) => item.id === toolCallId,
      )?.interaction;
      if (interaction?.kind !== "plan_review")
        throw new Error("Plan review unavailable. Refresh and try again.");
      const request = interaction.request;
      await resolve(toolCallId, {
        kind: "plan_review",
        decision: "approve",
        feedback: options?.feedback,
        confirmation: {
          targetProfile: request.targetProfile,
          expectedRevision: request.expectedRevision,
          expectedDigest: request.expectedDigest,
          transitionId: createId("input"),
          choices: {
            ...(options?.implementationModel
              ? { model: options.implementationModel }
              : {}),
            ...(options?.implementationThinkingLevel !== undefined
              ? { reasoningLevel: options.implementationThinkingLevel }
              : {}),
          },
        },
      });
    },
    rejectPendingPlanReview(toolCallId: string) {
      return resolve(toolCallId, { kind: "plan_review", decision: "reject" });
    },
  };
}
