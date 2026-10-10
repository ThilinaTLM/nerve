import type { SubscriptionUsageEntry } from "$lib/features/usage/usage-types";
import { usageState } from "$lib/features/usage/state/usage-state.svelte";
const SUBSCRIPTION_PROVIDER_ORDER = ["anthropic", "openai-codex"] as const;
export const usageSelectors = {
  get subscriptionUsages(): SubscriptionUsageEntry[] {
    return SUBSCRIPTION_PROVIDER_ORDER.map((provider) => ({
      provider,
      usage: usageState.subscriptionUsage[provider],
      active: false,
    }));
  },
};
