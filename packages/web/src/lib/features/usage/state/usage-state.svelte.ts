import type { SubscriptionUsage } from "$lib/api";

export const usageState = $state({
  subscriptionUsage: {} as Record<string, SubscriptionUsage>,
});
