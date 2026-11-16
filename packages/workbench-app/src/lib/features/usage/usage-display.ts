import type { SubscriptionQuota, SubscriptionUsage } from "$lib/api";
import {
  formatResetAfterSeconds,
  formatResetAt,
  usageTone,
  usageWindowDisplay,
} from "@nervekit/ui-kit/display/usage";

/**
 * Presentation of subscription quotas, shared by the status-bar chip and the
 * phone status sheet. Time windows (Anthropic, Codex) show a percentage and a
 * countdown; count allowances (Copilot) add used/limit, a reset date and
 * overage; unlimited quotas collapse into one summary line.
 */

export type MeterTone = "success" | "warning" | "destructive";

/** A quota rendered as a meter row. */
export type DisplayMeter = {
  quota: SubscriptionQuota;
  label: string;
  /** Chip prefix for time windows (S, W); count quotas have none. */
  abbreviation: string | null;
};

export function subscriptionProviderLabel(provider: string): string {
  if (provider === "openai-codex") return "Codex";
  if (provider === "anthropic") return "Anthropic";
  if (provider === "github-copilot") return "Copilot";
  return provider;
}

function isCount(quota: SubscriptionQuota): boolean {
  return quota.limit != null;
}

/** Quotas with a cap, in provider order. */
export function quotaMeters(
  usage: SubscriptionUsage | null | undefined,
): DisplayMeter[] {
  if (!usage) return [];
  return usage.quotas
    .filter((quota) => !quota.unlimited)
    .map((quota) => {
      if (isCount(quota)) {
        return { quota, label: quota.label, abbreviation: null };
      }
      const display = usageWindowDisplay(quota.windowMinutes, {
        label: quota.label,
        abbreviation: quota.label.charAt(0).toUpperCase(),
      });
      return { quota, ...display };
    });
}

/** Uncapped quotas that still report consumption (pooled organization credits). */
export function consumptionQuotas(
  usage: SubscriptionUsage | null | undefined,
): SubscriptionQuota[] {
  return (usage?.quotas ?? []).filter(
    (quota) => quota.unlimited && (quota.used != null || quota.exhausted),
  );
}

/** "AI credits unlimited" for uncapped quotas without consumption. */
export function unlimitedSummary(
  usage: SubscriptionUsage | null | undefined,
): string | null {
  const labels = (usage?.quotas ?? [])
    .filter(
      (quota) => quota.unlimited && quota.used == null && !quota.exhausted,
    )
    .map((quota) => quota.label);
  if (labels.length === 0) return null;
  const list =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
  return `${list} unlimited`;
}

const countFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});

export function formatCount(value: number): string {
  return countFormat.format(value);
}

export function percentLabel(value: number | null | undefined): string {
  return value == null ? "—" : `${Math.round(value)}%`;
}

/** Compact countdown to the quota's reset, e.g. "2h 14m" or "16d 3h". */
export function quotaResetCountdown(quota: SubscriptionQuota): string | null {
  return (
    formatResetAt(quota.resetsAt) ??
    formatResetAfterSeconds(quota.resetAfterSeconds)
  );
}

/** Chip countdown: monthly allowances only need whole days. */
export function quotaResetShort(quota: SubscriptionQuota): string | null {
  const countdown = quotaResetCountdown(quota);
  if (!countdown || !isCount(quota)) return countdown;
  return countdown.match(/^\d+d/)?.[0] ?? countdown;
}

function resetDate(quota: SubscriptionQuota): string | null {
  if (!quota.resetsAt) return null;
  const date = new Date(quota.resetsAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function overageUsed(quota: SubscriptionQuota): number {
  return quota.overage?.used ?? 0;
}

function limitReached(quota: SubscriptionQuota): boolean {
  return (
    quota.exhausted === true ||
    (quota.usedPercent != null && quota.usedPercent >= 100) ||
    overageUsed(quota) > 0
  );
}

export function meterTone(quota: SubscriptionQuota): MeterTone {
  // Paid additional usage keeps working past the allowance: warn, don't alarm.
  if (limitReached(quota)) {
    return quota.overage?.permitted ? "warning" : "destructive";
  }
  const tone = usageTone(quota.usedPercent);
  if (tone === "error") return "destructive";
  if (tone === "warning") return "warning";
  return "success";
}

/** Meter headline: "960 / 1,500" for allowances, "42%" for time windows. */
export function meterValue(quota: SubscriptionQuota): string {
  if (quota.limit != null && quota.used != null) {
    return `${formatCount(quota.used)} / ${formatCount(quota.limit)}`;
  }
  return percentLabel(quota.usedPercent);
}

/** Muted line under a meter or consumption row. */
export function quotaCaption(quota: SubscriptionQuota): string | undefined {
  const date = resetDate(quota);
  const countdown = quotaResetCountdown(quota);
  if (!isCount(quota) && !quota.unlimited) {
    return countdown ? `resets in ${countdown}` : undefined;
  }
  const resets = date ? `resets ${date}` : null;
  const unit = quota.unit;
  let status: string | null = null;
  if (quota.unlimited) {
    status = quota.exhausted
      ? "Organization limit reached"
      : "Included with your organization's plan";
  } else if (overageUsed(quota) > 0) {
    status = [
      `+${formatCount(overageUsed(quota))}`,
      unit,
      "billed as additional usage",
    ]
      .filter(Boolean)
      .join(" ");
  } else if (limitReached(quota)) {
    status = quota.overage?.permitted
      ? "Allowance used · additional usage is billed"
      : "Limit reached";
  } else if (quota.limit != null && quota.used != null) {
    status = `${formatCount(Math.max(0, quota.limit - quota.used))} left`;
  }
  return [status, resets].filter(Boolean).join(" · ") || undefined;
}

/** Consumption headline for an uncapped quota, e.g. "343 credits used". */
export function consumptionValue(quota: SubscriptionQuota): string {
  if (quota.used == null) return "—";
  return `${formatCount(quota.used)}${quota.unit ? ` ${quota.unit}` : ""} used`;
}

/** Chip text for an uncapped quota: "343 cr", or "limit" once exhausted. */
export function consumptionChipValue(quota: SubscriptionQuota): string {
  if (quota.exhausted) return "limit reached";
  if (quota.used == null) return "included";
  const unit = quota.unit === "credits" ? " cr" : "";
  return `${formatCount(quota.used)}${unit}`;
}
