import { conversationSelectors } from "$lib/features/conversations/state/conversation-selectors.svelte";

export const usageSelectors = {
  get activeSubscriptionUsage() {
    return conversationSelectors.activeSubscriptionUsage;
  },
};
