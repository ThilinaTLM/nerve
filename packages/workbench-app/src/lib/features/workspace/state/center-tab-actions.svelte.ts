import { SvelteSet } from "svelte/reactivity";
import type { CenterTabIdentity } from "$lib/core/types/state-types";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import {
  centerTabKey,
  centerTabsEqual,
  replaceOpenCenterTabs,
  setActiveCenterTab,
} from "./center-tabs.svelte";
import {
  disposeCenterTab,
  notifyCenterTabClosed,
  selectCenterTab,
} from "./center-tab-lifecycle.svelte";
import { planCenterTabClose } from "./center-tab-close-plan";
import {
  isGlobalCenterTab,
  removeGlobalTabFromSessions,
} from "./workspace-tab-sessions";

function tabIndex(tab: CenterTabIdentity): number {
  return workspaceState.openCenterTabs.findIndex((candidate) =>
    centerTabsEqual(candidate, tab),
  );
}

export function centerTabsToLeftOf(
  tab: CenterTabIdentity,
): CenterTabIdentity[] {
  const index = tabIndex(tab);
  return index <= 0 ? [] : workspaceState.openCenterTabs.slice(0, index);
}

export function centerTabsToRightOf(
  tab: CenterTabIdentity,
): CenterTabIdentity[] {
  const index = tabIndex(tab);
  return index === -1 ? [] : workspaceState.openCenterTabs.slice(index + 1);
}

export function centerTabsExcept(tab: CenterTabIdentity): CenterTabIdentity[] {
  return workspaceState.openCenterTabs.filter(
    (candidate) => !centerTabsEqual(candidate, tab),
  );
}

export function hasCenterTabsToLeftOf(tab: CenterTabIdentity): boolean {
  return centerTabsToLeftOf(tab).length > 0;
}

export function hasCenterTabsToRightOf(tab: CenterTabIdentity): boolean {
  return centerTabsToRightOf(tab).length > 0;
}

export async function closeCenterTab(tab: CenterTabIdentity): Promise<void> {
  await closeCenterTabs([tab]);
}

export async function closeCenterTabs(
  tabs: CenterTabIdentity[],
  fallbackPreferred?: CenterTabIdentity,
): Promise<void> {
  const requested = new SvelteSet(tabs.map(centerTabKey));
  const targets = workspaceState.openCenterTabs.filter((tab) =>
    requested.has(centerTabKey(tab)),
  );
  if (!targets.length) return;

  const closed: CenterTabIdentity[] = [];
  for (const tab of targets) {
    if (await disposeCenterTab(tab)) closed.push(tab);
  }
  if (!closed.length) return;

  const { remainingTabs, activeWasClosed, fallback } = planCenterTabClose({
    openTabs: workspaceState.openCenterTabs,
    activeTab: workspaceState.activeCenterTab,
    mru: workspaceState.centerTabMru,
    closedTabs: closed,
    preferredFallback: fallbackPreferred,
  });

  for (const tab of closed) {
    if (isGlobalCenterTab(tab)) removeGlobalTabFromSessions(tab);
  }
  replaceOpenCenterTabs(remainingTabs);

  const context = { remainingTabs, fallback, activeWasClosed };
  for (const tab of closed) await notifyCenterTabClosed(tab, context);

  if (!activeWasClosed) return;
  setActiveCenterTab(undefined);
  if (fallback) await selectCenterTab(fallback);
}
