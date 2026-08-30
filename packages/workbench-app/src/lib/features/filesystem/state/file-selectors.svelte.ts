import { fileViewKey, mermaidViewKey } from "$lib/domain/navigation/view-keys";
export interface FileSelectorWorkspaceReadModel {
  readonly activeCenterTab: { kind: string; id: string } | undefined;
}

const unregisteredWorkspaceReadModel: FileSelectorWorkspaceReadModel = {
  activeCenterTab: undefined,
};

let workspaceReadModel = unregisteredWorkspaceReadModel;

export function registerFileSelectorWorkspaceReadModel(
  readModel: FileSelectorWorkspaceReadModel,
): () => void {
  workspaceReadModel = readModel;
  return () => {
    if (workspaceReadModel === readModel)
      workspaceReadModel = unregisteredWorkspaceReadModel;
  };
}
import { fileState } from "./file-state.svelte";

export const fileSelectors = {
  get activeCenterFileView() {
    const active = workspaceReadModel.activeCenterTab;
    if (active?.kind !== "file") return undefined;
    return fileState.fileViews[fileViewKey(active.id)];
  },
  get activeCenterMermaidView() {
    const active = workspaceReadModel.activeCenterTab;
    if (active?.kind !== "mermaid") return undefined;
    return fileState.mermaidViews[mermaidViewKey(active.id)];
  },
  get openFileTabs() {
    return fileState.openFileTabIds;
  },
};
