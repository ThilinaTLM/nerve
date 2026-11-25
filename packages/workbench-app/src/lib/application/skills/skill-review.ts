import type { AvailableSkill, SkillReview } from "@nervekit/contracts/skills";

/** The skill list's problem line for a project skill that waits for the user; a decline has none. */
export function skillApprovalProblem(
  skill: Pick<AvailableSkill, "trustState" | "changedSinceDecision">,
): string | undefined {
  if (skill.trustState === "needs_review")
    return skill.changedSinceDecision
      ? "Changed since you trusted it"
      : "Waiting for your review";
  return undefined;
}

/** A project skill the agent is not told about until the user trusts it. */
export const skillIsPending = (skill: Pick<AvailableSkill, "trustState">) =>
  skill.trustState !== undefined && skill.trustState !== "trusted";

/** The review page's caption under the title. */
export function skillReviewCaption(
  review: Pick<SkillReview, "trustState" | "changedSinceDecision">,
): string {
  if (review.trustState === "trusted") return "From the repository · trusted";
  if (review.trustState === "declined")
    return review.changedSinceDecision
      ? "Declined · changed since you declined"
      : "From the repository · declined";
  if (review.changedSinceDecision)
    return "Changed since you trusted it · not used until you trust it again";
  return "From the repository · not used until you trust it";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}

export function scriptCount(review: Pick<SkillReview, "files">): number {
  return review.files.filter((file) => file.script).length;
}

/** The absolute path of one file of the reviewed folder. */
export function skillFilePath(folder: string, path: string): string {
  const separator = folder.includes("\\") && !folder.includes("/") ? "\\" : "/";
  return `${folder.replace(/[\\/]+$/, "")}${separator}${path}`;
}

/**
 * What approving does with the digest the user saw. If the files changed while
 * the page was open, the review is replaced and nothing is approved.
 */
export function approvalOutcome(
  shown: Pick<SkillReview, "contentDigest">,
  current: Pick<SkillReview, "contentDigest">,
): "approve" | "reload" {
  return shown.contentDigest === current.contentDigest ? "approve" : "reload";
}
