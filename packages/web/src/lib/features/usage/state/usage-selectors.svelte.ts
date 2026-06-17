import { workbenchSelectors } from "$lib/stores/workbench/selectors.svelte";

export const usageSelectors = {
  get activeSubscriptionUsage() {
    return workbenchSelectors.activeSubscriptionUsage;
  },
};
