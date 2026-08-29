export type TranscriptAnnouncementState = {
  active: boolean;
  sending: boolean;
  pendingApprovalId?: string;
  pendingApprovalCount?: number;
  pendingQuestionIds?: readonly string[];
  pendingPlanReviewIds?: readonly string[];
};

function normalizedIds(ids: readonly string[] | undefined): string {
  return [...(ids ?? [])].sort().join("\0");
}

export function transcriptAnnouncementForTransition(
  previous: TranscriptAnnouncementState | undefined,
  current: TranscriptAnnouncementState,
): string | undefined {
  if (!previous || !previous.active || !current.active) return undefined;
  const pendingApprovalCount = current.pendingApprovalCount ?? 0;
  if (
    pendingApprovalCount > 0 &&
    (pendingApprovalCount !== (previous.pendingApprovalCount ?? 0) ||
      current.pendingApprovalId !== previous.pendingApprovalId)
  ) {
    return pendingApprovalCount === 1
      ? "1 approval required."
      : `${pendingApprovalCount} approvals required.`;
  }

  const pendingQuestionCount = current.pendingQuestionIds?.length ?? 0;
  if (
    pendingQuestionCount > 0 &&
    normalizedIds(current.pendingQuestionIds) !==
      normalizedIds(previous.pendingQuestionIds)
  ) {
    return pendingQuestionCount === 1
      ? "Nerve is waiting for your answer."
      : `${pendingQuestionCount} answers required.`;
  }

  const pendingPlanReviewCount = current.pendingPlanReviewIds?.length ?? 0;
  if (
    pendingPlanReviewCount > 0 &&
    normalizedIds(current.pendingPlanReviewIds) !==
      normalizedIds(previous.pendingPlanReviewIds)
  ) {
    return pendingPlanReviewCount === 1
      ? "A plan is ready for review."
      : `${pendingPlanReviewCount} plans are ready for review.`;
  }
  if (current.sending && !previous.sending) return "Nerve is responding.";
  if (!current.sending && previous.sending) return "Response complete.";
  return undefined;
}
