import {
  addCenterTab,
  nextCenterTabAfterClose,
  removeCenterTab,
  selectCenterTab,
  setActiveCenterTab,
} from "./workbench/center-tabs.svelte";
import { workbenchState } from "./workbench/state.svelte";

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
  const closingActive = workbenchState.activeCenterTab?.kind === "logs";
  const fallback = nextCenterTabAfterClose(LOGS_TAB);
  removeCenterTab(LOGS_TAB);
  if (closingActive) void selectCenterTab(fallback);
}
