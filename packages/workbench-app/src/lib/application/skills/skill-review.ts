import type { SkillReview } from "@nervekit/contracts/skills";

/** The skill list's status line for a project skill the user has not approved. */
export function skillApprovalProblem(
  approval: "pending" | "changed" | undefined,
): string | undefined {
  if (approval === "pending") return "Waiting for your review";
  if (approval === "changed") return "Changed since you approved it";
  return undefined;
}

/** The review page's caption under the title. */
export function skillReviewCaption(status: SkillReview["status"]): string {
  if (status === "approved") return "From the repository · approved";
  if (status === "changed")
    return "Changed since you approved it · not used until you approve it again";
  return "From the repository · not used until you approve it";
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
