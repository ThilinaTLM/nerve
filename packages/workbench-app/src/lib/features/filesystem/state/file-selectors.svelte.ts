import { fileViewKey, mermaidViewKey } from "$lib/core/state/state-keys";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import { fileState } from "./file-state.svelte";

export const fileSelectors = {
  get activeCenterFileView() {
    const active = workspaceState.activeCenterTab;
    if (active?.kind !== "file") return undefined;
    return fileState.fileViews[fileViewKey(active.id)];
  },
  get activeCenterMermaidView() {
    const active = workspaceState.activeCenterTab;
    if (active?.kind !== "mermaid") return undefined;
    return fileState.mermaidViews[mermaidViewKey(active.id)];
  },
  get openFileTabs() {
    return fileState.openFileTabIds;
  },
};
