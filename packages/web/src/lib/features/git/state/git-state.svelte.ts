import { workbenchState } from "$lib/stores/workbench/state.svelte";

/** Compatibility facade for git and pull-request state during migration. */
export const gitState = {
  get gitContext() {
    return workbenchState.gitContext;
  },
  set gitContext(value) {
    workbenchState.gitContext = value;
  },
  get gitRefreshToken() {
    return workbenchState.gitRefreshToken;
  },
  set gitRefreshToken(value) {
    workbenchState.gitRefreshToken = value;
  },
  get prViews() {
    return workbenchState.prViews;
  },
  set prViews(value) {
    workbenchState.prViews = value;
  },
  get openPrTabIds() {
    return workbenchState.openPrTabIds;
  },
  set openPrTabIds(value) {
    workbenchState.openPrTabIds = value;
  },
};
