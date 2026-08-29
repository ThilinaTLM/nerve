import type { PlanReviewRecord } from "@nervekit/contracts/plans";

export function acceptedPlanFollowUp(planPath: string): string {
  return `The user accepted the plan at ${planPath}. Proceed with the implementation using that plan as the source of truth.`;
}

export function acceptedPlanInNewChatInstruction(planPath: string): string {
  return `The user accepted the plan at ${planPath} and chose to implement it in this new chat. Read that plan file and implement it as the source of truth.`;
}

export function implementationConversationTitle(
  review: PlanReviewRecord,
): string {
  return `Implement: ${review.title ?? review.slug}`;
}
