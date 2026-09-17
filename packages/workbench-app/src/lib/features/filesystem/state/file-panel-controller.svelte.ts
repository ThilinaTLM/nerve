import { RefreshCoordinator } from "$lib/application/refresh/refresh-coordinator";
import { SvelteSet } from "svelte/reactivity";
import {
  clearProjectMonitor,
  requestProjectRefresh,
  syncProjectMonitor,
} from "../api/filesystem.api";
import {
  ensureFileExplorerRoot,
  monitoredFileExplorerDirectories,
} from "./file-explorer-actions.svelte";
import {
  registerFileExplorerEventHandler,
  type FileExplorerChange,
} from "./file-explorer-events";
import { startFileExplorerRefreshScheduler } from "./file-explorer-refresh-scheduler";

export interface FilePanelControllerOptions {
  readonly projectId: string;
  readonly refresh: (directories?: readonly string[]) => Promise<void> | void;
  readonly initialize?: () => Promise<void> | void;
}

export interface FilePanelController {
  updateMonitorDemand(directories?: readonly string[]): Promise<void>;
  requestRefresh(): Promise<void>;
  stop(): void;
}

type RefreshDemand = FileExplorerChange;

/** Owns monitor demand and refresh sequencing for the visible files panel. */
export function startFilePanelController({
  projectId,
  refresh,
  initialize,
}: FilePanelControllerOptions): FilePanelController {
  let latestGeneration = -1;
  let stopped = false;
  const coordinator = new RefreshCoordinator<RefreshDemand>({
    merge: (current, next) => ({
      generation: Math.max(current?.generation ?? -1, next.generation),
      fullRefreshRequired:
        (current?.fullRefreshRequired ?? false) || next.fullRefreshRequired,
      directories: [
        ...new SvelteSet([
          ...(current?.directories ?? []),
          ...next.directories,
        ]),
      ],
    }),
    execute: async (demand) => {
      if (demand.generation <= latestGeneration) return;
      latestGeneration = demand.generation;
      await refresh(
        demand.fullRefreshRequired ? undefined : demand.directories,
      );
    },
  });

  const accept = (change: RefreshDemand): Promise<void> =>
    coordinator.request(change);
  const requestRefresh = async (): Promise<void> => {
    if (stopped) return;
    const result = await requestProjectRefresh(projectId);
    await accept({
      generation: result.generation,
      directories: [],
      fullRefreshRequired: true,
    });
  };

  void Promise.resolve(
    initialize ? initialize() : ensureFileExplorerRoot(projectId),
  )
    .then(() =>
      syncProjectMonitor(
        projectId,
        monitoredFileExplorerDirectories(projectId),
      ),
    )
    .catch(() => undefined);
  const scheduler = startFileExplorerRefreshScheduler({
    refresh: requestRefresh,
    intervalMs: false,
  });
  const unregisterEvents = registerFileExplorerEventHandler(
    projectId,
    (change) => {
      void accept(change);
    },
  );

  return {
    async updateMonitorDemand(
      directories = monitoredFileExplorerDirectories(projectId),
    ) {
      if (stopped) return;
      await syncProjectMonitor(projectId, [...directories]).catch(
        () => undefined,
      );
    },
    requestRefresh,
    stop() {
      if (stopped) return;
      stopped = true;
      unregisterEvents();
      scheduler.stop();
      coordinator.stop();
      void clearProjectMonitor(projectId);
    },
  };
}
