import { loadLaunchLogWindow } from "$lib/features/launches/state/launch-logs.svelte";
import { launchState } from "$lib/features/launches/state/launch-state.svelte";
import {
  addCenterTab,
  nextCenterTabAfterClose,
  removeCenterTab,
  selectCenterTab,
  setActiveCenterTab,
} from "$lib/application/workspace/center-tabs.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { launchEntryId } from "$lib/features/launches/views/launch-panel-controller";

export function launchEntryKey(launchId: string): string {
  const launch = launchState.launches.find(
    (candidate) => candidate.id === launchId,
  );
  return launch ? launchEntryId(launch) : launchId;
}

export function runForLaunchEntry(entryId: string) {
  const selectedId = launchState.selectedRunByEntry[entryId];
  const candidates = launchState.launches
    .filter((launch) => launchEntryId(launch) === entryId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return candidates.find((launch) => launch.id === selectedId) ?? candidates[0];
}

export function setLaunchEntryRun(entryId: string, launchId: string): void {
  launchState.selectedRunByEntry[entryId] = launchId;
}

export async function selectLaunchEntryRun(
  entryId: string,
  launchId: string,
): Promise<void> {
  const launch = launchState.launches.find(
    (candidate) =>
      candidate.id === launchId && launchEntryId(candidate) === entryId,
  );
  if (!launch) return;
  setLaunchEntryRun(entryId, launchId);
  launchState.selectedLaunchId = launchId;
  await loadLaunchLogWindow(launchId);
}

export async function openLaunchTab(launchId: string) {
  const owningLaunch = launchState.launches.find(
    (candidate) => candidate.id === launchId,
  );
  if (
    owningLaunch?.projectId &&
    owningLaunch.projectId !== workspaceState.selectedProjectId
  ) {
    const { selectProject } =
      await import("$lib/application/workspace/workspace-actions.svelte");
    await selectProject(owningLaunch.projectId);
  }
  const entryId = launchEntryKey(launchId);
  setLaunchEntryRun(entryId, launchId);
  addCenterTab({ kind: "launch", id: entryId });
  await selectCenterLaunchTab(entryId);
}

export async function selectCenterConversationTab(conversationId: string) {
  const tab = { kind: "conversation" as const, id: conversationId };
  addCenterTab(tab);
  await selectCenterTab(tab);
}

export async function selectCenterLaunchTab(entryId: string) {
  const launch = runForLaunchEntry(entryId);
  addCenterTab({ kind: "launch", id: entryId });
  setActiveCenterTab({ kind: "launch", id: entryId });
  if (launch) await selectLaunchEntryRun(entryId, launch.id);
  else launchState.selectedLaunchId = undefined;
}

export async function closeLaunchTab(entryId: string) {
  const tab = { kind: "launch" as const, id: entryId };
  const closingActive =
    workspaceState.activeCenterTab?.kind === "launch" &&
    workspaceState.activeCenterTab.id === entryId;
  const fallback = nextCenterTabAfterClose(tab);
  removeCenterTab(tab);
  delete launchState.selectedRunByEntry[entryId];

  if (
    launchState.selectedLaunchId &&
    launchEntryKey(launchState.selectedLaunchId) === entryId
  ) {
    launchState.selectedLaunchId = undefined;
    launchState.launchLogs = undefined;
  }

  if (closingActive) await selectCenterTab(fallback);
}
