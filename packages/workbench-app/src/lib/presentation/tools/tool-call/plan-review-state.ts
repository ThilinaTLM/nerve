import type { PlanReviewRecord } from "@nervekit/contracts/plans";
import type { ToolCallTranscriptRecord } from "@nervekit/contracts/tools";

type PlanReviewToolCall = Pick<
  ToolCallTranscriptRecord,
  | "id"
  | "agentId"
  | "conversationId"
  | "projectId"
  | "toolName"
  | "status"
  | "interactions"
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
  const interaction = toolCall.interactions.find(
    (candidate) => candidate.status === "pending",
  );
  if (!interaction || interaction.kind !== "plan_review") return undefined;

  const reviewId = `plan_review_${toolCall.id}_${interaction.ordinal}`;
  if (projected?.id === reviewId && projected.status === "pending") {
    return projected;
  }

  return {
    id: reviewId,
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
