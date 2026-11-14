import type { AccountHealth } from "@nervekit/contracts/auth";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import { relativeTimeLabel } from "@nervekit/ui-kit/display/time";

export type HealthBadge = { label: string; tone: StatusTone };

/** Results older than this are re-checked when the Extensions page opens. */
export const ACCOUNT_HEALTH_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * Badge for the latest test of an account. "Credentials rejected" is reserved
 * for a refused secret; missing access and transient failures get their own
 * wording so a network blip never reads as an expired token.
 */
export function accountHealthBadge(
  result: Pick<AccountHealth, "status"> | undefined,
): HealthBadge {
  switch (result?.status) {
    case "verified":
      return { label: "Verified", tone: "success" };
    case "rejected":
      return { label: "Credentials rejected", tone: "destructive" };
    case "restricted":
      return { label: "Access restricted", tone: "warning" };
    case "unavailable":
      return { label: "Not available", tone: "neutral" };
    case "unreachable":
      return { label: "Couldn’t check", tone: "warning" };
    default:
      return { label: "Not checked", tone: "neutral" };
  }
}

export function accountHealthDetail(result: AccountHealth | undefined): string {
  if (!result) return "No connection test yet.";
  const age = relativeTimeLabel(result.checkedAt);
  return [
    `Tested ${age === "now" ? "just now" : `${age} ago`}.`,
    result.message,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Whether an account should be re-tested automatically. */
export function accountHealthStale(
  result: Pick<AccountHealth, "checkedAt"> | undefined,
  now: number = Date.now(),
  maxAgeMs: number = ACCOUNT_HEALTH_MAX_AGE_MS,
): boolean {
  return !result || now - new Date(result.checkedAt).getTime() > maxAgeMs;
}
