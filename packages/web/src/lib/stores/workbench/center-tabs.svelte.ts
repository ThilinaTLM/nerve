import type { CenterTabIdentity } from "./state.svelte";
import { workbenchState } from "./state.svelte";

export function centerTabKey(tab: CenterTabIdentity): string {
  return `${tab.kind}:${tab.id}`;
}

export function setActiveCenterTab(tab: CenterTabIdentity | undefined) {
  workbenchState.activeCenterTab = tab;
  if (tab?.kind === "process") workbenchState.selectedProcessId = tab.id;
}

export function fallbackCenterTab(): CenterTabIdentity | undefined {
  const sessionId =
    workbenchState.activeConversationTabId ??
    workbenchState.openConversationTabIds[0];
  if (sessionId) return { kind: "conversation", id: sessionId };
  const processId = workbenchState.openProcessTabIds[0];
  if (processId) return { kind: "process", id: processId };
  const fileId = workbenchState.openFileTabIds[0];
  if (fileId) return { kind: "file", id: fileId };
  if (workbenchState.settingsTabOpen) return { kind: "settings", id: "settings" };
  return undefined;
}

export function activateFallbackCenterTab() {
  setActiveCenterTab(fallbackCenterTab());
}
