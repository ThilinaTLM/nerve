import { requestWorkbench } from "$lib/application/startup/workbench-connection";
import { refreshLaunchLogWindow } from "./launch-logs.svelte";
import {
  onEvent,
  onWorkbenchReconnect,
} from "$lib/application/events/workbench-event-bus";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { launchState } from "./launch-state.svelte";

export function registerLaunchEventHandlers(): () => void {
  const disposers = [
    onWorkbenchReconnect(refreshWorkbenchLaunches),
    onEvent("launch.output", handleLaunchLogEvent),
    onEvent("launch.removed", handleLaunchRemovedEvent),
    onEvent("launch.created", handleLaunchRecordEvent),
    onEvent("launch.started", handleLaunchRecordEvent),
    onEvent("launch.runtime_updated", handleLaunchRecordEvent),
    onEvent("launch.ready", handleLaunchRecordEvent),
    onEvent("launch.stop_requested", handleLaunchRecordEvent),
    onEvent("launch.readiness_failed", handleLaunchRecordEvent),
    onEvent("launch.timed_out", handleLaunchRecordEvent),
    onEvent("launch.completed", handleLaunchRecordEvent),
    onEvent("launch.failed", handleLaunchRecordEvent),
    onEvent("launch.cancelled", handleLaunchRecordEvent),
    onEvent("launch.updated", handleLaunchRecordEvent),
  ];
  return () => {
    for (const dispose of disposers.splice(0)) dispose();
  };
}

function handleLaunchRecordEvent(event: {
  data?: Record<string, unknown>;
}): void {
  if (!event.data?.launch) return;
  void refreshWorkbenchLaunches().catch(() => undefined);
}

function handleLaunchRemovedEvent(event: {
  data?: Record<string, unknown>;
}): void {
  const launchId = String(event.data?.launchId ?? "");
  if (!launchId) return;
  launchState.launches = launchState.launches.filter(
    (launch) => launch.id !== launchId,
  );
  if (launchState.selectedLaunchId === launchId) {
    launchState.selectedLaunchId = undefined;
    launchState.launchLogs = undefined;
  }
}

function handleLaunchLogEvent(event: { data?: Record<string, unknown> }): void {
  handleLaunchRecordEvent(event);
  const launchId = String(event.data?.launchId ?? "");
  const launch = launchState.launches.find(
    (candidate) => candidate.id === launchId,
  );
  const entryId =
    launch?.definitionId ?? launch?.restartRootLaunchId ?? launchId;
  const viewingLaunch =
    workspaceState.activeCenterTab?.kind === "launch" &&
    workspaceState.activeCenterTab.id === entryId;
  if (launchId && launchId === launchState.selectedLaunchId && viewingLaunch) {
    void refreshLaunchLogWindow(launchId).catch(() => undefined);
  }
}

export async function refreshWorkbenchLaunches(): Promise<void> {
  launchState.launches = (await requestWorkbench("launch.list", {})).launches;
  if (
    launchState.selectedLaunchId &&
    !launchState.launches.some(
      (launch) => launch.id === launchState.selectedLaunchId,
    )
  ) {
    launchState.selectedLaunchId = undefined;
    launchState.launchLogs = undefined;
  }
  if (launchState.selectedLaunchId)
    await refreshLaunchLogWindow(launchState.selectedLaunchId);
}
