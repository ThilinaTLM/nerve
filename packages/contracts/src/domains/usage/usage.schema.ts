import { z } from "zod";

/** Providers that expose subscription (plan) usage limits. */
export const subscriptionUsageProviderSchema = z.enum([
  "anthropic",
  "openai-codex",
]);
export type SubscriptionUsageProvider = z.infer<
  typeof subscriptionUsageProviderSchema
>;

/**
 * A single rate-limit window.
 *
 * Anthropic reports an absolute `resetsAt`; Codex reports a relative
 * `resetAfterSeconds`. Either may be `null` when unknown.
 */
export const subscriptionWindowSchema = z.object({
  usedPercent: z.number().nullable(),
  resetsAt: z.string().datetime().nullable(),
  resetAfterSeconds: z.number().nullable(),
  windowMinutes: z.number().nullable(),
});
export type SubscriptionWindow = z.infer<typeof subscriptionWindowSchema>;

/**
 * Normalized subscription usage for a provider.
 *
 * `session` maps to Anthropic's 5-hour window / Codex's primary window.
 * `weekly` maps to Anthropic's 7-day window / Codex's secondary window.
 */
export const subscriptionUsageSchema = z.object({
  provider: subscriptionUsageProviderSchema,
  session: subscriptionWindowSchema.nullable(),
  weekly: subscriptionWindowSchema.nullable(),
  planType: z.string().nullable().optional(),
  updatedAt: z.string().datetime(),
});
export type SubscriptionUsage = z.infer<typeof subscriptionUsageSchema>;

export const subscriptionUsageListSchema = z.array(subscriptionUsageSchema);

/** Event type carrying a refreshed {@link SubscriptionUsage} snapshot. */
export const SUBSCRIPTION_USAGE_EVENT = "usage.subscription.updated";
