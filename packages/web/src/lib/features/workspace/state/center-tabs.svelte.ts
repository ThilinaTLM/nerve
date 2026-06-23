import type { CenterTabIdentity } from "$lib/core/types/state-types";
import { authState } from "$lib/features/auth/state/auth-state.svelte";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { fileState } from "$lib/features/filesystem/state/file-state.svelte";
import { gitState } from "$lib/features/git/state/git-state.svelte";
import { logsState } from "$lib/features/logs/state/log-state.svelte";
import { notify } from "$lib/features/notifications/notify.svelte";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { taskState } from "$lib/features/tasks/state/task-state.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
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

function syncLegacyTabFields() {
  conversationState.openConversationTabIds = workspaceState.openCenterTabs
    .filter((tab) => tab.kind === "conversation")
    .map((tab) => tab.id);
  taskState.openTaskTabIds = workspaceState.openCenterTabs
    .filter((tab) => tab.kind === "task")
    .map((tab) => tab.id);
  fileState.openFileTabIds = workspaceState.openCenterTabs
    .filter((tab) => tab.kind === "file")
    .map((tab) => tab.id);
  gitState.openPrTabIds = workspaceState.openCenterTabs
    .filter((tab) => tab.kind === "pr")
    .map((tab) => tab.id);
  settingsState.settingsTabOpen = workspaceState.openCenterTabs.some(
    (tab) => tab.kind === "settings",
  );
  authState.authTabOpen = workspaceState.openCenterTabs.some(
    (tab) => tab.kind === "auth",
  );
  logsState.logsTabOpen = workspaceState.openCenterTabs.some(
    (tab) => tab.kind === "logs",
  );
}

export function replaceOpenCenterTabs(tabs: CenterTabIdentity[]) {
  const seen = new Set<string>();
  workspaceState.openCenterTabs = tabs.filter((tab) => {
    const key = centerTabKey(tab);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  syncLegacyTabFields();
}

export function addCenterTab(tab: CenterTabIdentity) {
  if (
    !workspaceState.openCenterTabs.some((candidate) =>
      centerTabsEqual(candidate, tab),
    )
  ) {
    workspaceState.openCenterTabs = [...workspaceState.openCenterTabs, tab];
    syncLegacyTabFields();
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
    workspaceState.activeCenterTab = next;
  }
}

export function nextCenterTabAfterClose(
  tab: CenterTabIdentity,
): CenterTabIdentity | undefined {
  const tabs = workspaceState.openCenterTabs;
  const closingIndex = tabs.findIndex((candidate) =>
    centerTabsEqual(candidate, tab),
  );
  if (closingIndex === -1) return fallbackCenterTab(tab);
  const remaining = tabs.filter(
    (candidate) => !centerTabsEqual(candidate, tab),
  );
  return remaining[closingIndex] ?? remaining[closingIndex - 1] ?? remaining[0];
}

export function removeCenterTab(tab: CenterTabIdentity) {
  replaceOpenCenterTabs(
    workspaceState.openCenterTabs.filter(
      (candidate) => !centerTabsEqual(candidate, tab),
    ),
  );
}

export function setActiveCenterTab(tab: CenterTabIdentity | undefined) {
  if (tab) addCenterTab(tab);
  workspaceState.activeCenterTab = tab;
  if (tab?.kind === "task") taskState.selectedTaskId = tab.id;
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
