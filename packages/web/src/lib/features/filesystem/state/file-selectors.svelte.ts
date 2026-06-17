import { workbenchSelectors } from "$lib/stores/workbench/selectors.svelte";

export const fileSelectors = {
  get activeCenterFileView() {
    return workbenchSelectors.activeCenterFileView;
  },
};
