import {
  addCenterTab,
  nextCenterTabAfterClose,
  removeCenterTab,
  selectCenterTab,
  setActiveCenterTab,
} from "$lib/features/workspace/state/center-tabs.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";

const LOGS_TAB = { kind: "logs" as const, id: "logs" as const };

export function openLogsPane() {
  addCenterTab(LOGS_TAB);
  setActiveCenterTab(LOGS_TAB);
}

export function selectCenterLogsTab() {
  addCenterTab(LOGS_TAB);
  setActiveCenterTab(LOGS_TAB);
}

export function closeLogsTab() {
  const closingActive = workspaceState.activeCenterTab?.kind === "logs";
  const fallback = nextCenterTabAfterClose(LOGS_TAB);
  removeCenterTab(LOGS_TAB);
  if (closingActive) void selectCenterTab(fallback);
}
