import { workbenchSelectors } from "$lib/stores/workbench/selectors.svelte";

export const gitSelectors = {
  get activeCenterPrView() {
    return workbenchSelectors.activeCenterPrView;
  },
  get gitStatus() {
    return workbenchSelectors.gitStatus;
  },
  get gitSuggestions() {
    return workbenchSelectors.gitSuggestions;
  },
  get branchDepth() {
    return workbenchSelectors.branchDepth;
  },
};
