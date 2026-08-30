import { diffViewKey, prViewKey } from "$lib/domain/navigation/view-keys";
import { gitState } from "./state/git-state.svelte";

export const gitWorkspaceReadModel = {
  get diffViews() {
    return gitState.diffViews;
  },
  get prViews() {
    return gitState.prViews;
  },
  get openDiffTabIds() {
    return gitState.openDiffTabIds;
  },
  get openPrTabIds() {
    return gitState.openPrTabIds;
  },
};

export const gitWorkspaceCommands = {
  setOpenDiffTabIds(ids: string[]): void {
    gitState.openDiffTabIds = ids;
  },
  setOpenPrTabIds(ids: string[]): void {
    gitState.openPrTabIds = ids;
  },
  restorePrView(id: string, view: (typeof gitState.prViews)[string]): void {
    gitState.prViews[prViewKey(id)] = view;
  },
  restoreDiffView(id: string, view: (typeof gitState.diffViews)[string]): void {
    gitState.diffViews[diffViewKey(id)] = view;
  },
  discardDiffView(id: string): void {
    delete gitState.diffViews[diffViewKey(id)];
  },
};
