import type { CancelLaunchRequest } from "@nervekit/contracts/launches";
import {
  cancelLaunch,
  deleteLaunch,
  pruneLaunches,
  restartLaunch,
  startLaunch,
} from "$lib/api";
import { notify } from "$lib/application/notifications/notify.svelte";
import {
  loadLaunchLogWindow,
  refreshLaunchLogWindow,
} from "$lib/features/launches/state/launch-logs.svelte";
import { launchState } from "$lib/features/launches/state/launch-state.svelte";
import {
  activateFallbackCenterTab,
  removeCenterTab,
} from "$lib/application/workspace/center-tabs.svelte";
import {
  setLaunchEntryRun,
  launchEntryKey,
} from "$lib/features/launches/state/launch-tabs.svelte";
import { refreshWorkbenchLaunches } from "./launch-events";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
export async function selectLaunch(launchId: string) {
  launchState.selectedLaunchId = launchId;
  await loadLaunchLogWindow(launchId);
}

export async function cancelSelectedLaunch(
  launchId: string,
  request: CancelLaunchRequest = {},
) {
  await cancelLaunch(launchId, request);
  await refreshWorkbenchLaunches();
  if (launchState.selectedLaunchId) {
    await loadLaunchLogWindow(launchState.selectedLaunchId);
  }
  notify.success(
    request.signal === "SIGKILL" ? "Launch force killed" : "Launch cancelled",
  );
}

export async function restartSelectedLaunch(launchId: string) {
  const entryId = launchEntryKey(launchId);
  const restarted = await restartLaunch(launchId);
  setLaunchEntryRun(entryId, restarted.id);
  launchState.selectedLaunchId = restarted.id;
  await refreshWorkbenchLaunches();
  await loadLaunchLogWindow(restarted.id);
  notify.success("Launch restarted", {
    description: restarted.name ?? restarted.command ?? restarted.id,
  });
}

function forgetLaunch(launchId: string) {
  const entryId = launchEntryKey(launchId);
  const remaining = launchState.launches
    .filter(
      (launch) =>
        launch.id !== launchId &&
        (launch.definitionId ?? launch.restartRootLaunchId ?? launch.id) ===
          entryId,
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (remaining[0]) setLaunchEntryRun(entryId, remaining[0].id);
  else removeCenterTab({ kind: "launch", id: entryId });
  if (
    workspaceState.activeCenterTab?.kind === "launch" &&
    workspaceState.activeCenterTab.id === launchId
  ) {
    activateFallbackCenterTab();
  }
  if (launchState.selectedLaunchId === launchId) {
    launchState.selectedLaunchId = undefined;
    launchState.launchLogs = undefined;
  }
}

export async function removeLaunch(launchId: string) {
  await deleteLaunch(launchId);
  forgetLaunch(launchId);
  await refreshWorkbenchLaunches();
  notify.success("Launch removed");
}

export async function cleanupLaunchRuns(launchIds: readonly string[]) {
  const ids = launchIds.filter((id, index) => launchIds.indexOf(id) === index);
  if (ids.length === 0) return;

  const results = await Promise.allSettled(ids.map((id) => deleteLaunch(id)));
  const removed = ids.filter(
    (_, index) => results[index]?.status === "fulfilled",
  );
  const failed = ids.length - removed.length;
  for (const id of removed) forgetLaunch(id);
  await refreshWorkbenchLaunches();

  if (removed.length > 0) {
    notify.success(
      removed.length === 1
        ? "Removed 1 old launch run"
        : `Removed ${removed.length} old launch runs`,
    );
  }
  if (failed > 0) {
    notify.error(
      failed === 1
        ? "Could not remove 1 old launch run"
        : `Could not remove ${failed} old launch runs`,
    );
  }
}

export async function pruneFinishedLaunches() {
  const { removed } = await pruneLaunches();
  for (const id of removed) forgetLaunch(id);
  await refreshWorkbenchLaunches();
  notify.success(
    removed.length === 1
      ? "Removed 1 finished launch"
      : `Removed ${removed.length} finished launches`,
  );
}

export async function runLaunchCommand(input: {
  projectId: string;
  cwd: string;
  command: string;
  name?: string;
}) {
  const launch = await startLaunch(input);
  await refreshWorkbenchLaunches();
  await selectLaunch(launch.id);
  notify.success("Command started", {
    description: input.name ?? input.command,
  });
  return launch;
}

export async function refreshLaunchLogs() {
  await refreshLaunchLogWindow();
}
