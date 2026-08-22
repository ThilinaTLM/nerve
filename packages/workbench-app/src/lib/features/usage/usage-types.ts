import type { SubscriptionUsage } from "$lib/api";

export type SubscriptionProvider = "anthropic" | "openai-codex";

export type SubscriptionUsageEntry = {
  provider: SubscriptionProvider;
  usage?: SubscriptionUsage;
  active: boolean;
};
