import { workbenchState } from "$lib/stores/workbench/state.svelte";

/** Compatibility facade for file viewer state during migration. */
export const fileState = {
  get fileViews() {
    return workbenchState.fileViews;
  },
  set fileViews(value) {
    workbenchState.fileViews = value;
  },
  get openFileTabIds() {
    return workbenchState.openFileTabIds;
  },
  set openFileTabIds(value) {
    workbenchState.openFileTabIds = value;
  },
};
