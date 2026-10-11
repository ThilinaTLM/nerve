import { loadLaunchLogWindow } from "./state/launch-logs.svelte";
import { resolveSelectedLaunchId } from "./state/launch-reducers";
import { launchState } from "./state/launch-state.svelte";

export const launchWorkspaceReadModel = {
  get launches() {
    return launchState.launches;
  },
  get openLaunchTabIds() {
    return launchState.openLaunchTabIds;
  },
  get selectedLaunchId() {
    return launchState.selectedLaunchId;
  },
  get selectedRunByEntry() {
    return launchState.selectedRunByEntry;
  },
  get launchLogs() {
    return launchState.launchLogs;
  },
};

export const launchWorkspaceCommands = {
  setLaunches(launches: typeof launchState.launches): void {
    launchState.launches = launches;
  },
  setOpenLaunchTabIds(ids: string[]): void {
    launchState.openLaunchTabIds = ids;
  },
  setSelectedLaunchId(id: string | undefined): void {
    launchState.selectedLaunchId = id;
  },
  clearLaunchLogs(): void {
    launchState.launchLogs = undefined;
  },
  resolveSelectedLaunchId,
  loadLaunchLogWindow,
};
