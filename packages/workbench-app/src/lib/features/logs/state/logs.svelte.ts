import {
  addCenterTab,
  setActiveCenterTab,
} from "$lib/features/workspace/state/center-tabs.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";

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

export function disposeLogsTab(): void {}
