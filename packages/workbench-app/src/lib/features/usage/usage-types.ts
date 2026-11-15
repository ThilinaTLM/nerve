import type { SubscriptionUsage } from "$lib/api";
import type { SubscriptionUsageProvider } from "@nervekit/contracts/usage";

export type SubscriptionProvider = SubscriptionUsageProvider;

export type SubscriptionUsageEntry = {
  provider: SubscriptionProvider;
  usage?: SubscriptionUsage;
  active: boolean;
};
