import { usageState } from "$lib/features/usage/state/usage-state.svelte";
import { subscriptionUsageEntries } from "./subscription-usage-entries";

type UsageSelectionReadModel = {
  readonly selectedProvider: string | undefined;
};

let selectionReadModel: UsageSelectionReadModel | undefined;

export function registerUsageSelectionReadModel(
  readModel: UsageSelectionReadModel,
): () => void {
  selectionReadModel = readModel;
  return () => {
    if (selectionReadModel === readModel) selectionReadModel = undefined;
  };
}

export const usageSelectors = {
  get subscriptionUsages() {
    return subscriptionUsageEntries(
      usageState.subscriptionUsage,
      selectionReadModel?.selectedProvider,
    );
  },
};
