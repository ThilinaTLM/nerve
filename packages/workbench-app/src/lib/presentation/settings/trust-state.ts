import type { TrustState } from "@nervekit/contracts/core";

/** The one name of each decision state, on every surface. */
export const TRUST_STATE_LABELS: Record<TrustState, string> = {
  needs_review: "Needs review",
  trusted: "Trusted",
  declined: "Declined",
};

/** Only an undecided item asks for attention; a decline is the user's choice, so it stays quiet. */
export const TRUST_STATE_TONES: Record<
  TrustState,
  "warning" | "success" | "neutral"
> = {
  needs_review: "warning",
  trusted: "success",
  declined: "neutral",
};

/** What the state means for the item, for a badge's tooltip. */
export function trustStateTip(
  state: TrustState,
  changedSinceDecision = false,
): string {
  switch (state) {
    case "needs_review":
      return changedSinceDecision
        ? "Changed since you trusted it. Not used until you review it again."
        : "Not used until you review and trust it.";
    case "trusted":
      return "You trusted this exact content. Edits made in Nerve keep it trusted; any other change asks again.";
    case "declined":
      return changedSinceDecision
        ? "You declined it, and it changed since. It stays off until you review and trust it."
        : "You declined it. It stays off until you review and trust it.";
  }
}
