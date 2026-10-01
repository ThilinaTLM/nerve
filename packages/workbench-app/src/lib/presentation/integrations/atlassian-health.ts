import type {
  AtlassianProfileHealth,
  AtlassianService,
  IntegrationHealthResult,
} from "@nervekit/contracts/auth";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import { relativeTimeLabel } from "@nervekit/ui-kit/display/time";

export type HealthBadge = { label: string; tone: StatusTone };

/** Results older than this are re-checked when the Providers page opens. */
export const ATLASSIAN_HEALTH_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * Badge for one service. "Credentials rejected" is reserved for a refused
 * token; missing access and transient failures get their own wording so a
 * network blip never reads as an expired token.
 */
export function atlassianHealthBadge(
  result: IntegrationHealthResult | undefined,
): HealthBadge {
  switch (result?.status) {
    case "verified":
      return { label: "Verified", tone: "success" };
    case "rejected":
      return { label: "Credentials rejected", tone: "destructive" };
    case "restricted":
      return { label: "Access restricted", tone: "warning" };
    case "unavailable":
      return { label: "Not on this site", tone: "neutral" };
    case "unreachable":
      return { label: "Couldn’t check", tone: "warning" };
    default:
      return { label: "Not checked", tone: "neutral" };
  }
}

export function atlassianHealthDetail(
  result: IntegrationHealthResult | undefined,
): string {
  if (!result) return "No connection check yet.";
  const age = relativeTimeLabel(result.checkedAt);
  const when = age === "now" ? "just now" : `${age} ago`;
  const source =
    result.source === "check" ? "by a connection test" : "by a tool call";
  return [`Checked ${when} ${source}.`, result.message]
    .filter(Boolean)
    .join(" ");
}

/** Whether a ready profile should be re-checked automatically. */
export function atlassianHealthStale(
  health: AtlassianProfileHealth | undefined,
  now: number = Date.now(),
  maxAgeMs: number = ATLASSIAN_HEALTH_MAX_AGE_MS,
): boolean {
  const services: AtlassianService[] = ["jira", "confluence"];
  return services.some((service) => {
    const result = health?.[service];
    if (!result) return true;
    return now - new Date(result.checkedAt).getTime() > maxAgeMs;
  });
}
