export type TranscriptAnnouncementState = {
  active: boolean;
  sending: boolean;
  pendingApprovalId?: string;
  pendingApprovalCount?: number;
  pendingQuestionId?: string;
  pendingPlanReviewId?: string;
};

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
  if (
    current.pendingQuestionId &&
    current.pendingQuestionId !== previous.pendingQuestionId
  ) {
    return "Nerve is waiting for your answer.";
  }
  if (
    current.pendingPlanReviewId &&
    current.pendingPlanReviewId !== previous.pendingPlanReviewId
  ) {
    return "A plan is ready for review.";
  }
  if (current.sending && !previous.sending) return "Nerve is responding.";
  if (!current.sending && previous.sending) return "Response complete.";
  return undefined;
}
