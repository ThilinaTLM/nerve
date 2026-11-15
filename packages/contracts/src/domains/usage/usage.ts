import { z } from "zod";

/** Providers that expose subscription (plan) usage limits. */
export const subscriptionUsageProviderSchema = z.enum([
  "anthropic",
  "openai-codex",
  "github-copilot",
]);
export type SubscriptionUsageProvider = z.infer<
  typeof subscriptionUsageProviderSchema
>;

/**
 * One usage limit of a subscription: a rolling time window (Anthropic and
 * Codex session/weekly) or a monthly allowance counted in units (Copilot AI
 * credits or premium requests).
 *
 * Reset is reported either as an absolute `resetsAt` or a relative
 * `resetAfterSeconds`; either may be `null` when unknown.
 */
export const subscriptionQuotaSchema = z.object({
  /** Stable key within the snapshot, e.g. `session`, `weekly`, `credits`. */
  id: z.string(),
  label: z.string(),
  /** `null` when the quota has no limit to measure against. */
  usedPercent: z.number().nullable(),
  resetsAt: z.string().datetime().nullable(),
  resetAfterSeconds: z.number().nullable(),
  windowMinutes: z.number().nullable(),
  /** Units consumed, for count-based quotas. */
  used: z.number().nullable().optional(),
  /** Units included, for count-based quotas. */
  limit: z.number().nullable().optional(),
  /** Plural unit noun for `used`/`limit`, e.g. `credits`. */
  unit: z.string().optional(),
  /** No cap applies; `used` may still report consumption. */
  unlimited: z.boolean().optional(),
  /** A shared (organization) pool behind an unlimited quota is used up. */
  exhausted: z.boolean().optional(),
  /** Paid usage beyond the included allowance. */
  overage: z.object({ permitted: z.boolean(), used: z.number() }).optional(),
});
export type SubscriptionQuota = z.infer<typeof subscriptionQuotaSchema>;

/**
 * Normalized subscription usage for a provider. Quotas keep the provider's
 * order; time windows are classified by duration where the provider's own
 * positions are unreliable (Codex).
 */
export const subscriptionUsageSchema = z.object({
  provider: subscriptionUsageProviderSchema,
  quotas: z.array(subscriptionQuotaSchema),
  planType: z.string().nullable().optional(),
  updatedAt: z.string().datetime(),
});
export type SubscriptionUsage = z.infer<typeof subscriptionUsageSchema>;

export const subscriptionUsageListSchema = z.array(subscriptionUsageSchema);

/** Event type carrying a refreshed {@link SubscriptionUsage} snapshot. */
export const SUBSCRIPTION_USAGE_EVENT = "usage.subscription.updated";
