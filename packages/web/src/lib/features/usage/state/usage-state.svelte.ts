import { workbenchState } from "$lib/stores/workbench/state.svelte";

/** Compatibility facade for usage state during migration. */
export const usageState = {
  get subscriptionUsage() {
    return workbenchState.subscriptionUsage;
  },
  set subscriptionUsage(value) {
    workbenchState.subscriptionUsage = value;
  },
};
