import {
  addCenterTab,
  nextCenterTabAfterClose,
  removeCenterTab,
  selectCenterTab,
  setActiveCenterTab,
} from "$lib/application/workspace/center-tabs.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";

const LOGS_TAB = { kind: "logs" as const, id: "logs" as const };

export function openLogsPane() {
  if (!workspaceState.status?.capabilities.applicationLogs) return;
  addCenterTab(LOGS_TAB);
  setActiveCenterTab(LOGS_TAB);
}

export function selectCenterLogsTab() {
  if (!workspaceState.status?.capabilities.applicationLogs) return;
  addCenterTab(LOGS_TAB);
  setActiveCenterTab(LOGS_TAB);
}

export function closeLogsTab() {
  const closingActive = workspaceState.activeCenterTab?.kind === "logs";
  const fallback = nextCenterTabAfterClose(LOGS_TAB);
  removeCenterTab(LOGS_TAB);
  if (closingActive) void selectCenterTab(fallback);
}
