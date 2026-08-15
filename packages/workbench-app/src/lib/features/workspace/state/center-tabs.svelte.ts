import { SvelteSet } from "svelte/reactivity";
import type { CenterTabIdentity } from "$lib/core/types/state-types";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import {
  recordTabActivation,
  recordTabsChanged,
  reorderVisibleTab,
} from "./workspace-tab-sessions";
export function centerTabKey(tab: CenterTabIdentity): string {
  return `${tab.kind}:${tab.id}`;
}

export function centerTabsEqual(
  left: CenterTabIdentity | undefined,
  right: CenterTabIdentity | undefined,
): boolean {
  return Boolean(
    left && right && left.kind === right.kind && left.id === right.id,
  );
}

export type CenterTabsPresentationSnapshot = {
  openTabs: CenterTabIdentity[];
  activeTab?: CenterTabIdentity;
};

export function captureCenterTabsPresentation(): CenterTabsPresentationSnapshot {
  return {
    openTabs: workspaceState.openCenterTabs.map((tab) => ({ ...tab })),
    activeTab: workspaceState.activeCenterTab
      ? { ...workspaceState.activeCenterTab }
      : undefined,
  };
}

export function restoreCenterTabsPresentation(
  snapshot: CenterTabsPresentationSnapshot,
) {
  replaceOpenCenterTabs(snapshot.openTabs);
  setActiveCenterTab(snapshot.activeTab);
}

export function replaceOpenCenterTabs(tabs: CenterTabIdentity[]) {
  const seen = new SvelteSet<string>();
  workspaceState.openCenterTabs = tabs.filter((tab) => {
    const key = centerTabKey(tab);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  recordTabsChanged();
}

export function addCenterTab(tab: CenterTabIdentity) {
  if (
    !workspaceState.openCenterTabs.some((candidate) =>
      centerTabsEqual(candidate, tab),
    )
  ) {
    workspaceState.openCenterTabs = [...workspaceState.openCenterTabs, tab];
  }
}

export function replaceCenterTab(
  previous: CenterTabIdentity,
  next: CenterTabIdentity,
) {
  replaceOpenCenterTabs(
    workspaceState.openCenterTabs.map((tab) =>
      centerTabsEqual(tab, previous) ? next : tab,
    ),
  );
  if (centerTabsEqual(workspaceState.activeCenterTab, previous)) {
    setActiveCenterTab(next);
  }
}

export function reorderCenterTab(tab: CenterTabIdentity, targetIndex: number) {
  reorderVisibleTab(tab, targetIndex);
}

export function setActiveCenterTab(tab: CenterTabIdentity | undefined) {
  if (tab) addCenterTab(tab);
  workspaceState.activeCenterTab = tab;
  if (tab) recordTabActivation(tab);
  else recordTabsChanged();
}
