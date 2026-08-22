import type { SubscriptionUsageEntry } from "$lib/features/usage/usage-types";
import { conversationSelectors } from "$lib/features/conversations/state/conversation-selectors.svelte";
import { usageState } from "$lib/features/usage/state/usage-state.svelte";

/** Fixed display order so the popover layout stays stable across providers. */
const SUBSCRIPTION_PROVIDER_ORDER = ["anthropic", "openai-codex"] as const;

export const usageSelectors = {
  get activeSubscriptionProvider() {
    return conversationSelectors.activeSubscriptionProvider;
  },
  get activeSubscriptionUsage() {
    return conversationSelectors.activeSubscriptionUsage;
  },
  /** Both known providers in fixed order, flagged with the active model's provider. */
  get subscriptionUsages(): SubscriptionUsageEntry[] {
    const active = conversationSelectors.activeSubscriptionProvider;
    return SUBSCRIPTION_PROVIDER_ORDER.map((provider) => ({
      provider,
      usage: usageState.subscriptionUsage[provider],
      active: provider === active,
    }));
  },
};
