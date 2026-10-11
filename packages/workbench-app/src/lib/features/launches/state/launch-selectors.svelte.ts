import { isPathInDirectory } from "$lib/domain/filesystem/project-path";
export interface LaunchSelectorWorkspaceReadModel {
  readonly activeProjectDir: string | undefined;
  readonly activeCenterTab: { kind: string; id: string } | undefined;
}

const unregisteredWorkspaceReadModel: LaunchSelectorWorkspaceReadModel = {
  activeProjectDir: undefined,
  activeCenterTab: undefined,
};

let workspaceReadModel = unregisteredWorkspaceReadModel;

export function registerLaunchSelectorWorkspaceReadModel(
  readModel: LaunchSelectorWorkspaceReadModel,
): () => void {
  workspaceReadModel = readModel;
  return () => {
    if (workspaceReadModel === readModel)
      workspaceReadModel = unregisteredWorkspaceReadModel;
  };
}
import { launchEntryId } from "$lib/features/launches/views/launch-panel-controller";
import { launchState } from "./launch-state.svelte";

export const launchSelectors = {
  get launches() {
    return launchState.launches;
  },
  get scopedLaunches() {
    const projectDir = workspaceReadModel.activeProjectDir;
    if (!projectDir) return [];
    return launchState.launches.filter((launch) =>
      isPathInDirectory(launch.cwd, projectDir),
    );
  },
  get selectedLaunch() {
    return launchState.launches.find(
      (launch) => launch.id === launchState.selectedLaunchId,
    );
  },
  get activeCenterLaunch() {
    const active = workspaceReadModel.activeCenterTab;
    if (active?.kind !== "launch") return undefined;
    const candidates = launchState.launches
      .filter((launch) => launchEntryId(launch) === active.id)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return (
      candidates.find(
        (launch) => launch.id === launchState.selectedRunByEntry[active.id],
      ) ?? candidates[0]
    );
  },
  get activeCenterLaunchRuns() {
    const active = workspaceReadModel.activeCenterTab;
    if (active?.kind !== "launch") return [];
    return launchState.launches
      .filter((launch) => launchEntryId(launch) === active.id)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  },
  get launchLogs() {
    return launchState.launchLogs;
  },
};
