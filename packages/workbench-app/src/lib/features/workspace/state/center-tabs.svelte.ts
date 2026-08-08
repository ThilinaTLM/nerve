import { SvelteSet } from "svelte/reactivity";
import type { CenterTabIdentity } from "$lib/core/types/state-types";
import { notify } from "$lib/features/notifications/notify.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import { syncCenterTabMirrors } from "./center-tab-mirrors.svelte";
import {
  isGlobalCenterTab,
  mostRecentRemainingTab,
  recordTabActivation,
  recordTabsChanged,
  removeGlobalTabFromSessions,
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

type CenterTabKind = CenterTabIdentity["kind"];
type CenterTabOfKind<Kind extends CenterTabKind> = Extract<
  CenterTabIdentity,
  { kind: Kind }
>;
type CenterTabHandlerMap = {
  [Kind in CenterTabKind]: (tab: CenterTabOfKind<Kind>) => void | Promise<void>;
};

let centerTabSelectHandlers: CenterTabHandlerMap | undefined;
let centerTabCloseHandlers: CenterTabHandlerMap | undefined;

/**
 * Register the select/close handler for every center tab kind. The maps are
 * exhaustive (`CenterTabHandlerMap`, not `Partial`), so adding a new tab kind
 * to `CenterTabIdentity` is a compile error here until a handler is supplied —
 * preventing silently unclickable tabs.
 */
export function registerCenterTabDispatch(handlers: {
  select: CenterTabHandlerMap;
  close: CenterTabHandlerMap;
}) {
  centerTabSelectHandlers = handlers.select;
  centerTabCloseHandlers = handlers.close;
}

function handlerFor(
  handlers: CenterTabHandlerMap | undefined,
  tab: CenterTabIdentity,
): ((tab: CenterTabIdentity) => void | Promise<void>) | undefined {
  return handlers?.[tab.kind] as
    | ((tab: CenterTabIdentity) => void | Promise<void>)
    | undefined;
}

function handleCenterTabError(action: "switch" | "close", caught: unknown) {
  const message = caught instanceof Error ? caught.message : String(caught);
  workspaceState.error = message;
  notify.error(`Could not ${action} pane`, { description: message });
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
  syncCenterTabMirrors();
  recordTabsChanged();
}

export function addCenterTab(tab: CenterTabIdentity) {
  if (
    !workspaceState.openCenterTabs.some((candidate) =>
      centerTabsEqual(candidate, tab),
    )
  ) {
    workspaceState.openCenterTabs = [...workspaceState.openCenterTabs, tab];
    syncCenterTabMirrors();
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

export function nextCenterTabAfterClose(
  tab: CenterTabIdentity,
): CenterTabIdentity | undefined {
  return mostRecentRemainingTab(tab);
}

export function removeCenterTab(tab: CenterTabIdentity) {
  if (isGlobalCenterTab(tab)) removeGlobalTabFromSessions(tab);
  replaceOpenCenterTabs(
    workspaceState.openCenterTabs.filter(
      (candidate) => !centerTabsEqual(candidate, tab),
    ),
  );
}

export function reorderCenterTab(tab: CenterTabIdentity, targetIndex: number) {
  reorderVisibleTab(tab, targetIndex);
  syncCenterTabMirrors();
}

export function setActiveCenterTab(tab: CenterTabIdentity | undefined) {
  if (tab) addCenterTab(tab);
  workspaceState.activeCenterTab = tab;
  if (tab) recordTabActivation(tab);
  else recordTabsChanged();
}

export function fallbackCenterTab(
  excluding?: CenterTabIdentity,
): CenterTabIdentity | undefined {
  return workspaceState.openCenterTabs.find(
    (tab) => !excluding || !centerTabsEqual(tab, excluding),
  );
}

export async function selectCenterTab(tab: CenterTabIdentity | undefined) {
  if (!tab) {
    setActiveCenterTab(undefined);
    return;
  }
  try {
    const handler = handlerFor(centerTabSelectHandlers, tab);
    if (!handler) throw new Error(`No select handler for ${tab.kind} panes`);
    await handler(tab);
  } catch (caught) {
    handleCenterTabError("switch", caught);
  }
}

export async function closeCenterTab(tab: CenterTabIdentity) {
  try {
    const handler = handlerFor(centerTabCloseHandlers, tab);
    if (!handler) throw new Error(`No close handler for ${tab.kind} panes`);
    await handler(tab);
  } catch (caught) {
    handleCenterTabError("close", caught);
  }
}

export function activateFallbackCenterTab() {
  setActiveCenterTab(fallbackCenterTab());
}
