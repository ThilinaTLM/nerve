import type { PlanReviewRecord } from "@nervekit/contracts/plans";

import type { ToolCallTranscriptRecord } from "$lib/presentation/view-models/conversation";

type PlanReviewToolCall = Pick<
  ToolCallTranscriptRecord,
  | "id"
  | "agentId"
  | "conversationId"
  | "projectId"
  | "toolName"
  | "status"
  | "interaction"
>;

/**
 * Resolves the pending review owned by a plan_mode_present card.
 *
 * Transcript tool calls and workspace interaction projections update through
 * separate stores. Deriving from the durable interaction keeps the card usable
 * during the brief handoff before the external projection arrives.
 */
export function resolvePlanReview(
  toolCall: PlanReviewToolCall | undefined,
  projected: PlanReviewRecord | undefined,
): PlanReviewRecord | undefined {
  if (
    toolCall?.toolName !== "plan_mode_present" ||
    toolCall.status !== "waiting"
  ) {
    return undefined;
  }
  const interaction = toolCall.interaction;
  if (interaction?.kind !== "plan_review" || interaction.status !== "pending")
    return undefined;

  if (projected?.toolCallId === toolCall.id && projected.status === "pending") {
    return projected;
  }

  return {
    toolCallId: toolCall.id,
    agentId: toolCall.agentId,
    conversationId: toolCall.conversationId,
    projectId: toolCall.projectId,
    slug: interaction.request.slug,
    title: interaction.request.title,
    summary: interaction.request.summary,
    planPath: interaction.request.planPath,
    status: "pending",
    requestedAt: interaction.requestedAt,
    updatedAt: interaction.updatedAt,
  };
}
