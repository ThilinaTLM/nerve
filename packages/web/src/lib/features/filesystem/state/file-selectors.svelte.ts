import { fileViewKey } from "$lib/core/state/state-keys";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import { fileState } from "./file-state.svelte";

export const fileSelectors = {
  get activeCenterFileView() {
    const active = workspaceState.activeCenterTab;
    if (active?.kind !== "file") return undefined;
    return fileState.fileViews[fileViewKey(active.id)];
  },
  get openFileTabs() {
    return fileState.openFileTabIds;
  },
};
