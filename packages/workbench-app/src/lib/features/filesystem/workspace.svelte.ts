import { fileViewKey, mermaidViewKey } from "$lib/domain/navigation/view-keys";
import { fileState } from "./state/file-state.svelte";

export const filesystemWorkspaceReadModel = {
  get fileViews() {
    return fileState.fileViews;
  },
  get mermaidViews() {
    return fileState.mermaidViews;
  },
  get openFileTabIds() {
    return fileState.openFileTabIds;
  },
};

export const filesystemWorkspaceCommands = {
  setOpenFileTabIds(ids: string[]): void {
    fileState.openFileTabIds = ids;
  },
  restoreFileView(
    id: string,
    view: (typeof fileState.fileViews)[string],
  ): void {
    fileState.fileViews[fileViewKey(id)] = view;
  },
  restoreMermaidView(
    id: string,
    view: (typeof fileState.mermaidViews)[string],
  ): void {
    fileState.mermaidViews[mermaidViewKey(id)] = view;
  },
  discardFileView(id: string): void {
    delete fileState.fileViews[fileViewKey(id)];
  },
  discardMermaidView(id: string): void {
    delete fileState.mermaidViews[mermaidViewKey(id)];
  },
};
