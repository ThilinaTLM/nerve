import { usageState } from "$lib/features/usage/state/usage-state.svelte";

/** Read-only reactive usage data for application and feature consumers. */
export const usageReadModel = {
  get subscriptionUsage() {
    return usageState.subscriptionUsage;
  },
};
