import type { AvailableSkill } from "@nervekit/contracts/skills";

/** The skill list's problem line for a skill that waits for the user; a decline has none. */
export function skillApprovalProblem(
  skill: Pick<AvailableSkill, "trustState" | "changedSinceDecision">,
): string | undefined {
  if (skill.trustState === "needs_review")
    return skill.changedSinceDecision
      ? "Changed since you trusted it"
      : "Waiting for your review";
  return undefined;
}

/** A user or project skill the agent is not told about until the user trusts it. */
export const skillIsPending = (skill: Pick<AvailableSkill, "trustState">) =>
  skill.trustState !== undefined && skill.trustState !== "trusted";
