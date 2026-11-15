import type { AccountHealth } from "@nervekit/contracts/auth";
import type { StatusTone } from "@nervekit/ui-kit/display/status";

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

/** Whether an account should be re-tested automatically. */
export function accountHealthStale(
  result: Pick<AccountHealth, "checkedAt"> | undefined,
  now: number = Date.now(),
  maxAgeMs: number = ACCOUNT_HEALTH_MAX_AGE_MS,
): boolean {
  return !result || now - new Date(result.checkedAt).getTime() > maxAgeMs;
}

export type HealthIndicator = {
  icon: "circle-check" | "triangle-alert" | "circle-x" | "circle-minus";
  /** Text colour class of the icon. */
  class: string;
  label: string;
};

/**
 * The icon that follows an account's name: verified, a warning for restricted
 * or unreachable, rejected. Nothing when not checked or the kind has no test.
 */
export function accountHealthIndicator(
  result: Pick<AccountHealth, "status"> | undefined,
): HealthIndicator | undefined {
  const { label } = accountHealthBadge(result);
  switch (result?.status) {
    case "verified":
      return { icon: "circle-check", class: "text-success", label };
    case "restricted":
    case "unreachable":
      return { icon: "triangle-alert", class: "text-warning", label };
    case "rejected":
      return { icon: "circle-x", class: "text-destructive", label };
    case "unavailable":
      return { icon: "circle-minus", class: "text-muted-foreground", label };
    default:
      return undefined;
  }
}

/** "checked just now", "checked 5 min ago", "checked 3 h ago", "checked 2 d ago". */
export function formatChecked(
  checkedAt: string,
  now: number = Date.now(),
): string {
  const age = Math.max(0, now - new Date(checkedAt).getTime());
  const minutes = Math.floor(age / 60_000);
  if (minutes < 1) return "checked just now";
  if (minutes < 60) return `checked ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `checked ${hours} h ago`;
  return `checked ${Math.floor(hours / 24)} d ago`;
}
