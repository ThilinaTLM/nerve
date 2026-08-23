import {
  addCenterTab,
  nextCenterTabAfterClose,
  removeCenterTab,
  selectCenterTab,
  setActiveCenterTab,
} from "$lib/application/workspace/center-tabs.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";

export const DISCOVER_TAB = {
  kind: "discover" as const,
  id: "discover" as const,
};

export function openDiscoverPane(): void {
  addCenterTab(DISCOVER_TAB);
  setActiveCenterTab(DISCOVER_TAB);
}

export function selectCenterDiscoverTab(): void {
  addCenterTab(DISCOVER_TAB);
  setActiveCenterTab(DISCOVER_TAB);
}

export function closeDiscoverTab(): void {
  const closingActive = workspaceState.activeCenterTab?.kind === "discover";
  const fallback = nextCenterTabAfterClose(DISCOVER_TAB);
  removeCenterTab(DISCOVER_TAB);
  if (closingActive) void selectCenterTab(fallback);
}
