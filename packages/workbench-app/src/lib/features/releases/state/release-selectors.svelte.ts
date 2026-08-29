import { releaseState } from "./release-state.svelte";

export const releaseSelectors = {
  get latest() {
    return releaseState.latest;
  },
};
